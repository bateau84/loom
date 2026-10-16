#!/usr/bin/env python3
"""Real installed host + local scripted provider. Experimental bridge, not production acceptance."""
from __future__ import annotations
import argparse, base64, json, secrets, shutil, sqlite3, subprocess, tempfile, time
from contextlib import closing
from pathlib import Path
from urllib.request import Request
from installed_host_smoke import PrivateHost, isolated_environment, require
from handback_managed_host import ManagedExperimentHost


def request(host, method, path, body=None):
    # Writes only to the isolated host; never to the user's OpenCode process.
    require(path.startswith('/api/session') or path.startswith('/api/experimental/session'), 'Unexpected experiment endpoint')
    token=base64.b64encode(f'opencode:{host.password}'.encode()).decode()
    req=Request(host.url+path,data=None if body is None else json.dumps(body).encode(),method=method,
                headers={'Authorization':'Basic '+token,'Content-Type':'application/json'})
    with host.opener.open(req,timeout=15) as response: raw=response.read(4*1024*1024+1)
    require(len(raw)<=4*1024*1024,'Experiment response too large')
    return json.loads(raw) if raw else None


def state(root):
    dbpath=root/'bridge.sqlite'
    if not dbpath.exists(): return {}
    with closing(sqlite3.connect(dbpath.as_uri()+'?mode=ro',uri=True)) as db:
        row=db.execute("SELECT data FROM bridge_fixture WHERE key='state'").fetchone()
    return json.loads(row[0]) if row else {}


def await_state(root,predicate,label,timeout=45):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        data=state(root)
        require(not data.get('failure'),str(data.get('failure')))
        if predicate(data): return data
        time.sleep(.05)
    raise RuntimeError(f'{label}: timed out; state={state(root)}')


def active(host):
    response=request(host,'GET','/api/session/active')
    return response.get('data',response)


def await_idle(host,ids,timeout=20):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        if not any(i in active(host) for i in ids): return
        time.sleep(.05)
    raise RuntimeError(f'Sessions did not become idle: {ids}')


BASELINE_CASES = ['baseline','bridge','native-covered','cancelled','lost-receipt','restart']
COMPARISON_CASES = ['primary-redelegate','native-yielded-bridge','native-yielded-redelegate',
                    'primary-redelegate-restart','duplicate-worker','duplicate-primary']


def case_options(mode):
    require(mode in BASELINE_CASES + COMPARISON_CASES, 'Unknown experiment case')
    return {'routePrimary': mode in ['primary-redelegate','native-yielded-redelegate','primary-redelegate-restart'],
            'newerYields': mode in ['native-yielded-bridge','native-yielded-redelegate'],
            'restart': mode in ['restart','primary-redelegate-restart'],
            'duplicateTarget': mode.removeprefix('duplicate-') if mode.startswith('duplicate-') else None,
            'negative': mode in ['baseline','cancelled','native-yielded-bridge']}


def run_case(executable,repo,output,mode):
    case_output=output/mode; case_output.mkdir()
    with tempfile.TemporaryDirectory(prefix='loom-handback-') as temp:
        root=Path(temp);project=root/'project';project.mkdir()
        subprocess.run(['git','init','-q',str(project)],check=True)
        env=isolated_environment(root);env['LOOM_HANDBACK_EXPERIMENT']=str(root)
        options={'mode':mode,'assignment':'assignment-'+mode,'marker':'QUALIFIED-'+secrets.token_hex(8), **case_options(mode)}
        (root/'case.json').write_text(json.dumps(options));(root/'control.json').write_text('{}')
        agents={f'bridge-{role}':{'description':role+' fixture','mode':'primary' if role=='primary' else 'subagent',
                 'model':f'handback-fixture/{role}','system':'Follow the isolated handback experiment.'} for role in ['primary','worker','research']}
        config={'plugins':['*',str(repo),str(repo/'tests/handback')],'agents':agents,'model':'handback-fixture/primary','update':'disable','share':'disabled'}
        (Path(env['OPENCODE_CONFIG_DIR'])/'opencode.json').write_text(json.dumps(config))
        (project/'.loom.yaml').write_text('agents:\n  bridge-primary: {roles: [coordination]}\n  bridge-worker: {roles: [implementation]}\n  bridge-research: {roles: [research]}\n')
        host=None;result={'mode':mode,'status':'FAIL'}
        try:
            host_type=ManagedExperimentHost if options['restart'] else PrivateHost
            result['host_mode']='managed' if options['restart'] else 'private-stdio'
            host=host_type(executable,project,env,case_output,'initial')
            require(json.loads(host.get('/api/info','info')).get('version')=='2.0.29','Wrong server version')
            host.wait_roster('/api/plugin','plugins',lambda xs: all(any(x.get('id')==p and x.get('state',{}).get('status')=='active' for x in xs) for p in ['loom','loom.handback.experiment']))
            response=request(host,'POST','/api/session',{'agent':'bridge-primary','title':'Handback experiment',
                            'model':{'providerID':'handback-fixture','id':'primary'},'location':{'directory':str(project)}})
            primary=response.get('data',response)['id']
            request(host,'POST',f'/api/session/{primary}/prompt',{'text':'Run the original Worker assignment and coordinate the qualified result.'})
            data=await_state(root,lambda s:s.get('originalReturned') and s.get('researchReturned'),'delegation return and Research launch')
            require(data['primary']==primary,'Primary association differs')
            await_idle(host,[primary])
            require(data['research'] in active(host),'Research must remain running at the idle boundary')
            require(not data.get('answer'),'Answer arrived before original delegation returned and Primary became idle')
            result['precondition']={'original_delegation_returned':True,'primary_idle_before_answer':True,'research_running':True,'user_prompts':1}
            if options['newerYields']:
                calls=state(root).get('nativeCalls',[])
                require(len(calls)==1 and calls[0]['returned'] and calls[0]['status']=='completed'
                        and not calls[0]['after_answer'], 'Newer native generation did not yield before the answer')
                await_idle(host,[primary,data['worker']])
                result['precondition']['newer_native_generation_also_returned']=True
            if options['restart']:
                host.close();host=None
                host=ManagedExperimentHost(executable,project,env,case_output,'restarted')
                require(json.loads(host.get('/api/info','info')).get('version')=='2.0.29','Wrong restarted server version')
                host.wait_roster('/api/plugin','plugins',lambda xs:any(x.get('id')=='loom.handback.experiment' and x.get('state',{}).get('status')=='active' for x in xs))
                await_idle(host,[primary]);result['host_restarted']=True
            (root/'control.json').write_text(json.dumps({'releaseAnswer':True}))
            data=await_state(root,lambda s:s.get('completion'),'Worker completion')
            if options['negative']:
                await_idle(host,[primary,data['worker']]);time.sleep(1)
                data=state(root);require(data['coordinations']==0,'Unexpected primary coordination in negative control')
                require(data['nudges']==0,'Unexpected nudge in negative control')
            else:
                data=await_state(root,lambda s:s.get('coordinations')==1,'Primary next coordinating action')
                await_idle(host,[primary,data['worker']])
                require(data['research'] in active(host),'The bridge incorrectly waited for all background work')
                require(data['primaryRead'],'Primary did not retrieve authoritative completion')
                require(data['nudges']==(0 if mode=='native-covered' or options['routePrimary'] else 1),'Wrong nudge ownership/count')
            require(data['answers']==1 and data['completions']==1,'Repeated answer or Worker completion')
            require(data['workerRead'],'Worker did not retrieve authoritative thread')
            data=state(root)
            require(not data.get('failure'),str(data.get('failure')))
            require(data['answers']==1 and data['completions']==1 and data['coordinations']==(0 if options['negative'] else 1),'Counts changed after idle settlement')
            if options['routePrimary']:
                require(data['answerNotices']==1 and data['directWorkerRequests']==0
                        and data['nudges']==0 and data['redelegations']==1, 'Unexpected continuation owner')
                calls=[c for c in data['nativeCalls'] if c['after_answer']]
                require(len(calls)==1 and calls[0]['primary']==primary and calls[0]['worker']==data['worker']
                        and calls[0]['returned'] and calls[0]['status']=='completed', 'Native re-delegation did not return')
            if mode=='native-yielded-bridge':
                with closing(sqlite3.connect(root/'bridge.sqlite')) as db:
                    assignment=json.loads(db.execute('SELECT data FROM bridge_assignments WHERE id=?',(options['assignment'],)).fetchone()[0])
                require(assignment['return_owner']=='native' and assignment['handback']=='not-requested', 'Sticky-owner control changed')
                result['finding']='Reviewed selector remains native-owned after the newer call has returned'
            # Observe after all normal work settles. A scripted no-op does not
            # make an extra requested model step acceptable.
            time.sleep(.5)
            data=state(root)
            require(not data.get('failure'),str(data.get('failure')))
            require(not data.get('request_oracle',{}).get('violations'), 'Duplicate continuation before fault injection')
            if options['duplicateTarget']:
                (root/'control.json').write_text(json.dumps({'releaseAnswer':True,'injectDuplicate':True}))
                data=await_state(root,lambda s:any(v['role']==options['duplicateTarget'] and v['kind']=='request-after-terminal'
                    for v in s.get('request_oracle',{}).get('violations',[])), 'Duplicate continuation countercheck')
                await_idle(host,[primary,data['worker']]);data=state(root)
                require(data['completions']==1 and data['coordinations']==1, 'Countercheck must expose a duplicate hidden by write guards')
                result['countercheck']='DETECTED extra model request despite unchanged completion/write counts'
            require(not data.get('failure'), str(data.get('failure')))
            require(data['answers']==1 and data['completions']==1 and data['coordinations']==(0 if options['negative'] else 1), 'Final settled counts differ')
            result['observed']=data
            # Direct read proves meaningful ledger contents survived the full host path.
            ledger=next((root/'state/loom/actions-v1').glob('*/ledger.sqlite'))
            with closing(sqlite3.connect(ledger.as_uri()+'?mode=ro',uri=True)) as db:
                result['ledger_counts']=dict(db.execute('SELECT kind,COUNT(*) FROM ledger GROUP BY kind'))
            require(result['ledger_counts'].get('answer')==1 and result['ledger_counts'].get('completion')==1,'Missing persisted records')
            events=[json.loads(line) for line in (root/'audit.ndjson').read_text().splitlines()]
            reads=[e for e in events if e['type']=='loom-result' and e.get('agent')=='bridge-worker' and e.get('input',{}).get('view')=='thread']
            require(any(e['result']['question']['id']==data['question']['id'] and any(a['id']==data['answer']['id'] and options['marker'] in a['data']['statement'] for a in e['result']['answers']) for e in reads),'No observed full-thread answer retrieval')
            if not options['negative']:
                reads=[e for e in events if e['type']=='loom-result' and e.get('agent')=='bridge-primary' and e.get('input',{}).get('record_id')==data['completion']['id']]
                require(any(any(r['id']==data['completion']['id'] and r['kind']=='completion' for r in e['result']['items']) for e in reads),'No observed authoritative primary retrieval')
            if options['routePrimary']:
                reads=[e for e in events if e['type']=='loom-result' and e.get('agent')=='bridge-primary' and e.get('input',{}).get('view')=='thread']
                require(any(e['result']['question']['id']==data['question']['id'] and any(a['id']==data['answer']['id']
                    for a in e['result']['answers']) for e in reads), 'Primary never retrieved the authoritative answer')
                order=[e['type'] for e in events]
                require(order.index('answer-saved') < order.index('primary-answer-retrieved')
                    < next(i for i,e in enumerate(events) if e['type']=='newer-native-start' and e.get('after_answer'))
                    < order.index('worker-explicit-completion') < order.index('primary-completion-retrieved')
                    < order.index('primary-next-coordinating-action'), 'Causal order differs')
            result['status']='PASS'
        except Exception as error:
            result['status']='FAIL';result['error']=str(error)
        finally:
            # Teardown is not a successful continuation signal or a graceful-shutdown claim.
            if host: host.close()
            for name in ['audit.ndjson','bridge.sqlite']:
                if (root/name).exists(): shutil.copy2(root/name,case_output/name)
            (case_output/'result.json').write_text(json.dumps(result,indent=2))
        return result


def main():
    p=argparse.ArgumentParser();p.add_argument('--opencode',required=True);p.add_argument('--report-directory',type=Path,required=True)
    p.add_argument('--comparison',action='store_true')
    args=p.parse_args();output=args.report_directory.resolve();output.mkdir(parents=True,exist_ok=False)
    repo=Path(__file__).resolve().parents[1]
    version=subprocess.check_output([args.opencode,'--version'],text=True,timeout=15).strip()
    (output/'version.stdout.txt').write_text(version+'\n')
    require(version in ['2.0.29','opencode v2.0.29'],f'Expected exact OpenCode 2.0.29, got {version}')
    results=[]
    cases=COMPARISON_CASES if args.comparison else BASELINE_CASES
    for mode in cases:
        r=run_case(args.opencode,repo,output,mode);results.append(r);print(mode,r['status'],r.get('error',''),flush=True)
        if r['status']!='PASS': break
    report={'version':version,'results':results,'all_passed':len(results)==len(cases) and all(r['status']=='PASS' for r in results),
            'limits':'Scripted provider, test-only selector and injected assignment cancellation. Not production notification, arbitrary-client ownership detection, exhaustive race qualification, live-model quality or automatic uncertain-send retry.'}
    (output/'report.json').write_text(json.dumps(report,indent=2));require(report['all_passed'],'Handback experiment incomplete or failed')

if __name__=='__main__': main()
