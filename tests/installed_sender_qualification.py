#!/usr/bin/env python3
"""Production sender + pinned real plugin ctx; scripted local inference only."""
from __future__ import annotations
import argparse, json, secrets, shutil, sqlite3, subprocess, tempfile, time
from contextlib import closing
from pathlib import Path
from installed_host_smoke import PrivateHost, isolated_environment, require
from installed_handback_experiment import request, active, await_idle
from handback_managed_host import ManagedExperimentHost

CASES = ['default', 'normal', 'event', 'context', 'receipt-failure', 'context-startup', 'context-read-error', 'context-compacted', 'withdrawn-notice']

def state(root):
    p=root/'fixture.sqlite'
    if not p.exists(): return {}
    with closing(sqlite3.connect(p.as_uri()+'?mode=ro',uri=True)) as db:
        row=db.execute("SELECT data FROM fixture WHERE key='state'").fetchone()
    return json.loads(row[0]) if row else {}

def wait(root, predicate, label, timeout=60):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        s=state(root);require(not s.get('failure'),str(s.get('failure')))
        if predicate(s): return s
        time.sleep(.05)
    raise RuntimeError(f'{label} timed out; state={state(root)}')

def inspect(root):
    path=next((root/'state/loom/actions-v1').glob('*/ledger.sqlite'))
    with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)) as db:
        counts=dict(db.execute('SELECT kind,COUNT(*) FROM ledger GROUP BY kind'))
        events=[json.loads(x[0]) for x in db.execute("SELECT data FROM ledger WHERE kind='delivery-event' ORDER BY seq")]
        intents=[json.loads(x[0]) for x in db.execute("SELECT data FROM ledger WHERE kind='delivery-intent' ORDER BY seq")]
        projections=[dict(zip([d[0] for d in db.execute('SELECT * FROM primary_deliveries').description],r)) for r in db.execute('SELECT * FROM primary_deliveries')]
    return {'counts':counts,'events':events,'intents':intents,'projections':projections}

def isolation(root,env,project):
    require(root.is_relative_to('/tmp/opencode'), 'Scratch outside authorized root')
    keys=['HOME','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_STATE_HOME','XDG_CACHE_HOME','TMPDIR','XDG_RUNTIME_DIR','OPENCODE_CONFIG_DIR']
    require(all(Path(env[k]).is_relative_to(root) for k in keys),'Unisolated host path')
    require(not any('KEY' in k or 'TOKEN' in k or 'SECRET' in k for k in env),'Inherited credential environment')
    # Native V2 config searches ancestors, even beyond the repository root.
    for ancestor in project.parents:
        if ancestor==root: continue
        for name in ['opencode.json','opencode.jsonc','.opencode/opencode.json','.opencode/opencode.jsonc']:
            require(not (ancestor/name).exists(),f'Unexpected ancestor config: {ancestor/name}')
    return {'paths_owned':True,'credentials_not_inherited':True,'ancestor_configs_absent':True,'network':'owned loopback ports; external provider requests rejected'}

def run(executable,repo,out,mode):
    target=out/mode;target.mkdir()
    with tempfile.TemporaryDirectory(prefix='sender-host-',dir='/tmp/opencode') as temp:
        root=Path(temp);project=root/'project';project.mkdir();subprocess.run(['git','init','-q',str(project)],check=True)
        env=isolated_environment(root);env['LOOM_SENDER_QUALIFICATION']=str(root)
        options={'mode':mode,'assignment':'assignment-'+mode,'marker':'QUALIFIED-'+secrets.token_hex(8)}
        (root/'case.json').write_text(json.dumps(options));(root/'control.json').write_text('{}')
        agents={f'sender-{role}':{'description':role+' fixture','mode':'primary' if role=='primary' else 'subagent','model':f'sender-fixture/{role}','system':'Follow this isolated sender qualification.'} for role in ['primary','worker','research']}
        config={'plugins':['*',str(repo/'tests/sender-host')],'agents':agents,'model':'sender-fixture/primary','update':'disable','share':'disabled'}
        (Path(env['OPENCODE_CONFIG_DIR'])/'opencode.json').write_text(json.dumps(config))
        (project/'.loom.yaml').write_text('agents: {}\ninstructions: {enabled: false}\nledger: {capture: off}\n')
        result={'mode':mode,'status':'FAIL','isolation':isolation(root,env,project)};host=None
        try:
            host_type=ManagedExperimentHost if mode in ['context-startup','context-compacted'] else PrivateHost
            host=host_type(executable,project,env,target,'initial')
            require(json.loads(host.get('/api/info','info'))['version']=='2.0.29','Wrong exact host version')
            host.wait_roster('/api/plugin','plugins',lambda xs:any(x['id']=='loom.sender.qualification' and x.get('state',{}).get('status')=='active' for x in xs))
            r=request(host,'POST','/api/session',{'agent':'sender-primary','model':{'providerID':'sender-fixture','id':'primary'},'location':{'directory':str(project)},'title':'Sender qualification'})
            primary=r.get('data',r)['id']
            request(host,'POST',f'/api/session/{primary}/prompt',{'text':'Delegate original work and coordinate its qualified result.'})
            s=wait(root,lambda s:s.get('originalReturned') and s.get('researchReturned'),'original return')
            await_idle(host,[primary,s['worker']]);require(s['research'] in active(host),'Research not pending at idle boundary')
            require(s['answers']==2 and not s.get('answer'),'Research answered before primary idle')
            result['precondition']={'user_prompts':1,'original_returned':True,'exact_primary_idle_before_research_answer':True,'historical_conflicting_answers':2}
            (root/'control.json').write_text(json.dumps({'releaseAnswer':True}))
            require(s.get('searchRead'),'Actual Code Mode did not retrieve sender schema/help')
            if mode=='default':
                s=wait(root,lambda s:s.get('answers')==3,'stored default answer');time.sleep(.5)
                require(not s['nativeInputs'] and not s['completions'] and not s['coordinations'],'Default unexpectedly dispatched')
            elif mode=='withdrawn-notice':
                s=wait(root,lambda s:s.get('withdrawn') and s.get('deliveryRead'),'visible post-notice withdrawal')
                await_idle(host,[primary,s['worker']]);time.sleep(.2);s=state(root)
                require(s['redelegations']==0 and s['completions']==0 and s['coordinations']==0,'Withdrawal still caused native work')
                require(len(s['nativeInputs'])==1,'Withdrawal retracted/reinserted notice')
                require(s['withdrawal']['delivery_disposition']['admitted']==1,'Withdrawal misreported known admission')
            else:
                s=wait(root,lambda s:s.get('coordinations')==1,'actual coordination')
                await_idle(host,[primary,s['worker']]);time.sleep(.5);s=state(root)
                require(s['redelegations']==1 and s['nativeReturn']['status']=='completed','Native same-Worker delegation did not return')
                require(s['completions']==1 and s['coordinations']==1,'Repeated work')
                require(len(s['nativeInputs'])==1 and s['nativeInputs'][0]['sessionID']==primary,'Wrong or repeated native input')
                require(len(s['primaryPages'])==3 and len(s['workerPages'])==3,'Full paginated conflicting/qualified thread not retrieved')
                require(s['completion']['data']['work_ref']==s['ref'] and s['completion']['data']['assignment_id']==options['assignment'],'Original assignment identity lost')
                require(not s['request_oracle']['violations'],'Extra actionable provider request despite script guards')
                require(s['research'] in active(host),'Unrelated Research should still be active')
                if mode in ['context-startup','context-compacted']:
                    before=inspect(root);require(not before['projections'][0]['receipt_id'],'Lost receipt was unexpectedly established')
                    if mode=='context-compacted':
                        request(host,'POST',f'/api/session/{primary}/compact',{})
                        await_idle(host,[primary]);time.sleep(.2)
                        r=request(host,'GET',f'/api/session/{primary}/context');messages=r.get('data',r) if isinstance(r,dict) else r
                        require(not any(m.get('id')==s['nativeInputs'][0]['id'] for m in messages),'Compaction did not remove notice from active history')
                        result['actual_compacted_context']=messages
                    result['before_restart']=before;host.close();host=None
                    prior_reads=sum(json.loads(line)['type']=='actual-plugin-context' for line in (root/'audit.ndjson').read_text().splitlines())
                    host=ManagedExperimentHost(executable,project,env,target,'restarted')
                    host.wait_roster('/api/plugin','plugins',lambda xs:any(x['id']=='loom.sender.qualification' and x.get('state',{}).get('status')=='active' for x in xs))
                    end=time.monotonic()+20
                    while time.monotonic()<end:
                        reads=sum(json.loads(line)['type']=='actual-plugin-context' for line in (root/'audit.ndjson').read_text().splitlines())
                        if reads>prior_reads:break
                        time.sleep(.05)
                    require(reads>prior_reads,'Startup did not use actual plugin context');time.sleep(.2)
                    result['startup_recovery']=True
                else:
                    expected='admission-uncertain' if mode=='context-read-error' else 'admitted'
                    require(s.get('retry',{}).get('delivery_status',{}).get('transport')==expected,'Explicit retry did not recover/suppress truthfully')
            data=inspect(root);result['ledger']=data
            require(data['counts']['answer']==3 and data['counts']['delivery-intent']==3,'Historical/source exchange changed')
            require(all(i['data']['automatic_continuation'] is False for i in data['intents'][:2]),'Historical consent changed')
            if mode!='default':
                receipts=[e for e in data['events'] if e['data']['phase']=='admitted']
                if mode in ['context-read-error','context-compacted']:
                    require(not receipts and not data['projections'][0]['receipt_id'],'Unavailable/compacted evidence invented a receipt')
                    result['admission_outcome']='uncertain; no resend, NOT a delivery success'
                else:
                    require(len(receipts)==1,'No exact positive receipt')
                    expected={'normal':'ACK','event':'live-enqueued','context':'context-promoted','receipt-failure':'context-promoted','context-startup':'context-promoted','withdrawn-notice':'ACK'}[mode]
                    require(receipts[0]['data']['evidence_kind']==expected,f'Wrong proof source {receipts[0]["data"]}')
                require(len([e for e in data['events'] if e['data']['phase']=='send-started'])==1,'Multiple local native call permits')
            result['observed']=state(root);require(len(result['observed']['nativeInputs'])==(0 if mode=='default' else 1),'Restart duplicated native input')
            events=[json.loads(x) for x in (root/'audit.ndjson').read_text().splitlines()]
            require(len([e for e in events if e['type']=='actual-synthetic-entry'])==(0 if mode=='default' else 1),'Actual transport duplicated')
            if mode not in ['default','withdrawn-notice']:
                order=[e['type'] for e in events]
                require(order.index('original-returned')<order.index('actual-synthetic-entry')<order.index('native-redelegation-entry')<order.index('explicit-completion')<order.index('native-completion-return')<order.index('actual-coordination'),'Causal composition order differs')
            result['status']='PASS'
        except Exception as error:result['error']=str(error)
        finally:
            if host:
                host.close();result['owned_process_dead']=host.proc.poll() is not None
            for name in ['audit.ndjson','fixture.sqlite']:
                if (root/name).exists():shutil.copy2(root/name,target/name)
            if (root/'state').exists():shutil.copytree(root/'state',target/'state')
            (target/'result.json').write_text(json.dumps(result,indent=2))
        return result

def main():
    p=argparse.ArgumentParser();p.add_argument('--opencode',required=True);p.add_argument('--report-directory',required=True,type=Path);p.add_argument('--case',choices=CASES,action='append');args=p.parse_args()
    output=args.report_directory.resolve();require(output.is_relative_to('/tmp/opencode'),'Reports must be scratch');output.mkdir(parents=True,exist_ok=False)
    version=subprocess.check_output([args.opencode,'--version'],text=True,timeout=15).strip();require(version in ['2.0.29','opencode v2.0.29'],'Exact pinned binary required')
    cases=args.case or CASES;results=[]
    for mode in cases:
        r=run(args.opencode,Path(__file__).resolve().parents[1],output,mode);results.append(r);print(mode,r['status'],r.get('error',''),flush=True)
        if r['status']!='PASS':break
    report={'version':version,'results':results,'all_passed':len(results)==len(cases) and all(r['status']=='PASS' for r in results),'limits':'Scripted provider; fault wrappers only at actual plugin ctx boundaries. Not live-model usefulness, arbitrary scheduler/exactly-once work, or default enablement.'}
    (output/'report.json').write_text(json.dumps(report,indent=2));require(report['all_passed'],'Sender qualification failed/incomplete')

if __name__=='__main__':main()
