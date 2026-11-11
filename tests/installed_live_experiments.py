"""Installed OpenCode 2.2.6 acceptance of Loom's REAL live-trial controller.

Uses the packed Loom plugin, unmodified CLI and local scripted provider. Unlike
the earlier manual-entry qualification, assignment and withdrawal must travel
through production loom_tweak callbacks. No paid inference or user files.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import secrets
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.request import Request

from installed_host_smoke import PrivateHost, installed_plugin_inventory, isolated_environment, require
from installed_questions import Scenario, events, idle, request

KEY = "loom.live-instruction.v1"
MARKER = "LOOM_INSTALLED_TREATMENT_V1"
HOST = "2.2.6"
SYSTEM = "Follow the deterministic local verification script."


def digest(value):
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def native_entries(host, session):
    token = base64.b64encode(("opencode:" + host.password).encode()).decode()
    path = f"/api/experimental/session/{session}/instructions/entries"
    req = Request(host.url + path, headers={"Authorization": "Basic " + token})
    with host.opener.open(req, timeout=15) as response:
        data = response.read(1024 * 1024 + 1)
    require(len(data) <= 1024 * 1024, "Native Session entry list exceeded budget")
    decoded = json.loads(data)
    value = decoded.get("data", decoded) if isinstance(decoded, dict) else decoded
    require(isinstance(value, list), "Native instruction entry API unavailable")
    return value


def native_replace_entry(host, session, value):
    """Deliberately mutate only a disposable host's native Session entry."""
    token = base64.b64encode(("opencode:" + host.password).encode()).decode()
    path = f"/api/experimental/session/{session}/instructions/entries/{KEY}"
    req = Request(host.url + path, method="PUT",
                  data=json.dumps({"value":value}).encode(),
                  headers={"Authorization":"Basic "+token,"Content-Type":"application/json"})
    with host.opener.open(req,timeout=15) as response:
        result=response.read(1025)
    require(len(result)<=1024, "Native drift mutation result exceeded budget")


def exact_message(host, session, line):
    rows = request(host, "GET", f"/api/session/{session}/message?order=desc&limit=100")
    require(isinstance(rows, list), "Native messages API unavailable")
    matching = [m for m in rows if m.get("type") == "user" and
                isinstance(m.get("id"), str) and m.get("text") == line]
    require(len(matching) == 1, "Exact original user approval message missing or ambiguous")
    return matching[0]["id"]


def code_result_events(root, start, session, name):
    return [e["data"] for e in events(root)[start:]
            if e["type"] == "tool-after" and e["data"].get("sessionID") == session
            and e["data"].get("tool") in ("loom_" + name, "loom." + name)]


def model_requests_for(root, job):
    marker = "LOOM_HARNESS_JOB:" + job
    return [e["data"] for e in events(root)
            if e["type"] == "provider-request" and marker in json.dumps(e["data"].get("prompt"))]


def prompt_text(event, role):
    parts = []
    for message in event.get("prompt", []):
        if message.get("role") != role:
            continue
        content = message.get("content")
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            parts.extend(value.get("text", "") for value in content if isinstance(value, dict) and isinstance(value.get("text"), str))
    return "\n".join(parts)


def provider_observation(root, job, treatment, host, session, candidate_text):
    rows = model_requests_for(root, job)
    require(rows, "PROVIDER_RECEIPT_MISSING: no final SDK input observed")
    entries = native_entries(host,session)
    require(entries == ([{"key":KEY,"value":candidate_text}] if treatment else []),
            "EXACT_NATIVE_ENTRY_READBACK_MISMATCH")
    original = request(host,"GET",f"/api/session/{session}/message?order=desc&limit=100")
    require(isinstance(original,list),"NATIVE_USER_SOURCE_UNAVAILABLE")
    require(not any(m.get("type")=="user" and MARKER in str(m.get("text",""))
                    for m in original), "NATIVE_USER_TEXT_CONTAMINATED")
    routes=[]
    for row in rows:
        system = prompt_text(row, "system")
        user = prompt_text(row, "user")
        require("LOOM_HARNESS_JOB:" + job in user, "Provider receipt not linked to exact scripted request")
        stage = {
            "roles": [m.get("role") for m in row.get("prompt", [])],
            "marker_system": MARKER in system,
            "marker_user": MARKER in user,
            "keyed_system": f'<context key="{KEY}">' in system,
            "keyed_user": f'<context key="{KEY}">' in user,
            "marker_user_occurrences": user.count(MARKER),
            "marker_system_occurrences": system.count(MARKER),
        }
        # OpenCode may deliver an instruction change as a native-generated
        # user-role context delta AFTER the Session already has model turns.
        # Reject user-authored spoofing via the independent native message scan
        # and exact Session-entry readback above; never equate a bare marker
        # with exposure without both origins and control isolation checked.
        seen = MARKER in system or MARKER in user
        require(seen is treatment,
                "PROVIDER_CONTROL_CONTAMINATION" if not treatment else "PROVIDER_TREATMENT_MISSING")
        routes.append("system-initial" if MARKER in system else
                      "native-user-role-delta" if MARKER in user else "no-candidate")
    return {"attempts": len(rows), "candidate_at_provider": treatment,
            "provider_routes": sorted(set(routes)),
            "system_fingerprints": sorted({digest(prompt_text(row, "system")) for row in rows})}


def native_wait(host, session):
    """Wait for the actual native coordinator; /active alone can briefly be empty."""
    token = base64.b64encode(("opencode:" + host.password).encode()).decode()
    req = Request(host.url + f"/api/experimental/session/{session}/wait",
                  data=b"", method="POST",
                  headers={"Authorization": "Basic " + token, "Content-Type": "application/json"})
    with host.opener.open(req, timeout=30) as response:
        payload = response.read(1024 + 1)
    require(len(payload) <= 1024, "Native coordinator wait returned oversized result")


def ordinary_prompt(scenario, session, case, hold=None):
    job, _ = scenario.begin(session, None, hold=hold)
    return job


def run(args):
    output = args.report_directory.resolve()
    output.mkdir(parents=True, exist_ok=False)
    report = {"status": "UNPROVEN", "kind": "installed-live-controller-2.2.6",
              "checks": [], "host": HOST, "sdk": HOST,
              "limits": ["Local scripted provider only; no live billing/provider or behavior-effectiveness claim.",
                         "Only explicitly authorized additive Session entries, never skill replacement.",
                         "Native tool use during treatment is excluded except bounded read/withdrawal.",
                         "Provider-side receipts are external to Loom; Loom does not certify delivery.",
                         "Existing model history is not cleansed by withdrawing an entry."]}
    host = None
    try:
        report["candidate"] = installed_plugin_inventory(
            args.artifact.resolve(), args.plugin.resolve(), args.expect_plugin_version, HOST)
        version = subprocess.check_output([str(args.opencode.resolve()), "--version"],text=True,timeout=15).strip()
        require(version in (HOST,"opencode v" + HOST), "EXACT_HOST_MISMATCH")
        with tempfile.TemporaryDirectory(prefix="loom-live-trials-") as temporary:
            root = Path(temporary).resolve()
            project = root / "project"
            project.mkdir()
            env = isolated_environment(root)
            env["LOOM_QUESTION_FIXTURE"] = str(root)
            (root / "jobs.json").write_text("{}")
            (project / ".loom.yaml").write_text("agents: {}\ninstructions: {enabled: false}\nledger: {capture: off}\n")
            config = {
                "plugins": ["*", str(args.plugin.resolve()),str((args.repository.resolve() / "tests/question-host").resolve())],
                "agents": {"question-reader": {
                    "description": "Private installed live experiment author",
                    "mode": "primary", "model": "question-fixture/reader", "system": SYSTEM,
                    "permissions": [{"action":"loom-live-instruction-experiment","resource":"*","effect":"allow"}],
                }},
                "model":"question-fixture/reader","update":"disable","share":"disabled",
            }
            config_file = Path(env["OPENCODE_CONFIG_DIR"]) / "opencode.json"
            config_file.write_text(json.dumps(config))
            subprocess.run(["git","init","-q",str(project)],env=env,check=True,timeout=10)
            original_config_hash = digest(config_file.read_bytes())
            def start(label):
                candidate = PrivateHost(str(args.opencode.resolve()),project,env,output,label)
                try:
                    require(json.loads(candidate.get("/api/info", "info")).get("version") == HOST,"Host version mismatch")
                    candidate.wait_roster("/api/plugin","plugins",lambda rows: all(any(
                        item.get("id") == name and item.get("state",{}).get("status")=="active"
                        for item in rows) for name in ("loom","loom.question.fixture")))
                    return candidate
                except Exception:
                    candidate.close()
                    raise

            host = start("initial")
            s = Scenario(host, root)
            treatment = s.session("reader")
            control = s.session("reader")
            proposer = s.session("reader")
            require(len({treatment,control,proposer}) == 3,"Native Sessions unexpectedly identical")
            s.command(treatment,"return await tools.loom.agents({})")
            original = [m for m in request(host,"GET",f"/api/session/{treatment}/message?order=desc&limit=100")
                        if m.get("type")=="user" and str(m.get("text","")).startswith("LOOM_HARNESS_JOB:")]
            require(original,"Missing real native source for objective")
            obj = s.invoke(treatment,"objective", {
                "operation":"create","source_type":"native-message","source_id":original[-1]["id"],
                "label":"Installed bounded response experiment","unit_key":"live-qualification",
            })
            require(obj.get("id") and obj.get("existing") is False, "Native source objective not created")
            candidate_text = MARKER + "\nThis harmless additive marker must stay Session-scoped."
            # Candidate content is authored outside BOTH comparison Sessions.
            # Otherwise a prior Code Mode tool result contaminates the future
            # treatment's user-role SDK input before native assignment.
            proposal = s.invoke(proposer,"tweak", {
                "operation":"propose","target_kind":"agent","target_id":"question-reader",
                "base_sha256":digest(SYSTEM),"candidate_content":candidate_text,
                "hypothesis":"Test whether the Session-scoped delivery boundary remains isolated",
                "evidence_refs":[original[-1]["id"]],
            })
            require(proposal["candidate_sha256"] == digest(candidate_text), "Proposed content identity incorrect")
            # SDK 2.2.6 user-role messages can be orchestrator-authored.
            # Permission rules can auto-allow. Both lack direct-human provenance.
            # Reproduce the exact candidate/scope/terms digest produced by
            # SessionExperiments.approvalBinding, without a circular message ID.
            expiry=__import__("datetime").datetime.fromtimestamp(
                time.time()+3500,__import__("datetime").timezone.utc).isoformat()
            eligibility="Only this native author Session and exact no-tool text route"
            criteria="Provider input isolation and independent runtime checks; no model-quality verdict"
            guarantees="No canonical changes, native permissions and billing guards unchanged"
            binding={
                "candidate_id":proposal["id"],
                "candidate_sha256":proposal["candidate_sha256"],
                "base_sha256":proposal["base_sha256"],
                "objective_id":obj["id"],"session_id":treatment,
                "agent":"question-reader","scope":"agent:question-reader",
                "budget_requests":8,"expires_at":expiry,
                "eligibility":eligibility,"evaluation_criteria":criteria,
                "preserved_guarantees":guarantees,
            }
            proof_hash=digest(json.dumps(binding,separators=(",",":"),ensure_ascii=False))
            approval=(f'LOOM-TRIAL-APPROVE v=2 candidate={proposal["id"]} '
                      f'sha256={proposal["candidate_sha256"]} objective={obj["id"]} '
                      f'session={treatment} agent=question-reader budget=8 '
                      f'approval_sha256={proof_hash}')
            request(host,"POST",f"/api/session/{treatment}/prompt",{"text":approval})
            idle(host,[treatment])
            approval_id = exact_message(host,treatment,approval)
            require(not any(e.get("key")==KEY for e in native_entries(host,treatment)),
                    "Native assignment existed before authorization")
            prior = s.invoke(control,"tweak",{"operation":"live-read"})
            require(prior.get("status")=="inactive","Control had preexisting trial")
            request_start={
                "operation":"live-start","objective_id":obj["id"],"candidate_id":proposal["id"],
                "authorize":True,"authorization_ref":approval_id,
                "eligibility":eligibility,"evaluation_criteria":criteria,
                "preserved_guarantees":guarantees,
                "budget_requests":8,"expires_at":expiry,
            }
            if not args.require_qualified_human_approval:
                # A failed native Code Mode script surfaces a generic wrapper
                # error. Verify the underlying exact failed execute state,
                # rather than treating any exception as evidence of denial.
                # Recover the rejection text inside the native Code Mode call:
                # uncaught tool errors are otherwise hidden by an outer wrapper.
                # A successful inner call returns UNSAFE_ACCEPTED and fails.
                code=("try{await tools.loom.tweak("+json.dumps(request_start)+");"
                      "return 'UNSAFE_ACCEPTED'}catch(error){return String(error)}")
                observed=s.command(treatment,code)
                executions=[e["data"] for e in observed if e["type"]=="tool-after"
                            and e["data"].get("tool")=="execute"]
                require(len(executions)==1 and
                        "LOOM_LIVE_HUMAN_PROVENANCE_UNQUALIFIED" in
                        json.dumps(executions[0].get("result",{})),
                        "Native trial call did not return the exact provenance refusal")
                require(native_entries(host,treatment)==[] and native_entries(host,control)==[],
                        "FAIL_OPEN: native instruction entry installed without trusted human")
                import sqlite3
                stores=list((root/"state/loom/actions-v1").glob("*/learning.sqlite"))
                require(len(stores)==1,"Cannot identify isolated trial history after denial")
                with sqlite3.connect(stores[0]) as db:
                    count=db.execute("SELECT COUNT(*) FROM learning_live_experiments").fetchone()[0]
                require(count==0,"FAIL_OPEN: rejected native trial still reserved admission")
                report["checks"].append("2.2.6-user-role-orchestrator-spoof-denied-no-trial-or-entry")
                report["blocked_capabilities"]=[
                    "Native direct-human provenance absent (SDK/CLI 2.2.6)",
                    "Native permission denied and interactive ask not qualified on the experiment route",
                    "Genuine task-dispatched child with human-origin approval unqualified",
                    "Provider treatment delivery and effectiveness not established",
                ]
                report["stage"]="safe-provenance-refusal"
                report["status"]="BLOCKED_PROVENANCE"
                return report
            assigned=s.invoke(treatment,"tweak",request_start)
            require(assigned.get("status")=="assigned" and assigned.get("provider_receipt") is None,
                    "Assignment was incorrectly credited as provider exposure")
            require(native_entries(host,treatment)==[{"key":KEY,"value":candidate_text}],
                    "Actual native Session storage does not match assigned candidate")
            require(native_entries(host,control)==[], "Concurrent control inherited treatment entry")
            report["checks"].append("explicit-native-user-authorization-and-assignment-readback")

            # Concurrent requests must overlap at provider input, not merely at
            # Python submit time. Fixture blocks after doStream receipts exist.
            cjob=ordinary_prompt(s,control,"control",hold="after")
            tjob=ordinary_prompt(s,treatment,"treatment",hold="after")
            report["barrier_jobs"] = {"control": cjob, "treatment": tjob}
            for label,job in (("control",cjob),("treatment",tjob)):
                report["stage"] = "provider-barrier-" + label
                try:
                    s.await_event(lambda e,j=job:e["type"]=="provider-held" and e["data"].get("job")==j)
                except Exception as error:
                    report["barrier_debug"] = [{
                        "type":e.get("type"),
                        "session":e.get("data",{}).get("sessionID"),
                        "kind":e.get("data",{}).get("kind"),
                        "status":e.get("data",{}).get("status"),
                        "tool":e.get("data",{}).get("tool"),
                        "job":e.get("data",{}).get("job"),
                        "role":e.get("data",{}).get("role"),
                    } for e in events(root)[-100:]]
                    messages=request(host,"GET",f"/api/session/{treatment}/message?order=desc&limit=12")
                    report["treatment_message_errors"] = [
                        {"type":m.get("type"),"error":str(m.get("error",""))[:320]}
                        for m in messages if m.get("error")]
                    raise RuntimeError(f"PROVIDER_BARRIER_MISSING_{label}: {error}") from error
            s.release(cjob)
            s.release(tjob)
            idle(host,[control,treatment])
            report["initial_provider"]={"control":provider_observation(root,cjob,False,host,control,candidate_text),
                                         "treatment":provider_observation(root,tjob,True,host,treatment,candidate_text)}
            report["checks"].append("same-location-concurrent-control-treatment-provider-input")

            c2=ordinary_prompt(s,control,"control-continuation")
            t2=ordinary_prompt(s,treatment,"treatment-continuation")
            idle(host,[control,treatment])
            provider_observation(root,c2,False,host,control,candidate_text)
            provider_observation(root,t2,True,host,treatment,candidate_text)
            report["checks"].append("fixed-content-continuation-and-control-isolation")

            # Rejected model-originated tool execution cannot be mistaken for
            # legitimate work. The real native execute tool is invoked and must
            # fail under the Loom pre-execute guard before its supplied code runs.
            started=len(events(root))
            unsafe='return await tools.loom.agents({})'
            rejected,_=s.begin(treatment,unsafe)
            s.await_event(lambda e:e["type"]=="provider-inputs" and e["data"].get("job")==rejected)
            native_wait(host,treatment)
            idle(host,[treatment])
            tool_events=[e for e in events(root)[started:] if e["type"] in ("tool-before","tool-after")
                         and e["data"].get("sessionID")==treatment]
            before=[e["data"] for e in tool_events if e["type"]=="tool-before"]
            after=[e["data"] for e in tool_events if e["type"]=="tool-after"]
            # OpenCode fires pre-execute hooks in registration order. A
            # rejecting Loom hook can stop the call BEFORE the passive audit
            # plugin's later execute.before callback runs. Prove the actual
            # native assistant tool-call failed with Loom's exact guard error,
            # not the presence of a hook invocation that may be skipped.
            native_messages=request(host,"GET",f"/api/session/{treatment}/message?order=desc&limit=100")
            native_calls=[
                part for m in native_messages if m.get("type")=="assistant"
                for part in (m.get("content") or [])
                if isinstance(part,dict) and part.get("type")=="tool" and part.get("name")=="execute"
            ]
            denied=[p for p in native_calls
                    if "LOOM_LIVE_TOOL_ROUTE_UNQUALIFIED" in json.dumps(p)]
            if not denied:
                report["denial_diagnostic"]={
                    "job":rejected,
                    "native_tool_states":[{"status":(p.get("state") or {}).get("status"),
                                           "type":p.get("type"),"name":p.get("name"),
                                           "error_excerpt":str((p.get("state") or {}).get("error",""))[:190]}
                                          for p in native_calls[-8:]],
                    "audit_events":[{"type":e["type"],"tool":e["data"].get("tool"),
                                     "status":e["data"].get("status")}
                                    for e in tool_events],
                }
            require(denied,
                    "Expected native failed execute call with Loom's exact pre-execute denial")
            require(not any(e["tool"] in ("loom_agents","loom.agents") for e in before),
                    "FAIL_OPEN: disallowed inner Loom tool actually ran")
            require(not any(e["tool"]=="execute" and e["status"]=="completed" for e in after),
                    "FAIL_OPEN: disallowed outer Code Mode program succeeded")
            provider_observation(root,rejected,True,host,treatment,candidate_text)
            report["checks"].append("real-unqualified-tool-execution-denied")

            host.close()
            host=start("restarted")
            s.host=host
            require(native_entries(host,treatment)==[{"key":KEY,"value":candidate_text}],
                    "Native trial identity did not survive host restart")
            rjob=ordinary_prompt(s,treatment,"treatment-after-restart")
            idle(host,[treatment])
            provider_observation(root,rjob,True,host,treatment,candidate_text)
            report["checks"].append("durable-restart-same-native-variant")

            # Real installed Code Mode execute wrapper must permit only the
            # exact recovery tool, even though ordinary tools are excluded.
            stopped=s.invoke(treatment,"tweak",{"operation":"live-stop"})
            require(stopped["status"]=="stopped" and stopped["control_eligible"] is False,
                    "Withdrawal misreported the previously exposed Session as a control")
            require(native_entries(host,treatment)==[], "Native experiment key not removed")
            report["checks"].append("qualified-native-withdrawal-and-history-preservation")
            after=ordinary_prompt(s,treatment,"withdrawn")
            idle(host,[treatment])
            rows=model_requests_for(root,after)
            require(rows,"Withdrawn Session did not resume ordinary native execution")
            report["withdrawn"]={"provider_attempts":len(rows),
                                 "historical_marker_still_present":any(MARKER in prompt_text(x,"system") for x in rows)}
            require(digest(config_file.read_bytes())==original_config_hash,
                    "Shared native agent/provider registry file changed during experiment")
            report["checks"].append("no-location-registry-or-canonical-file-mutation")
            # Negative oracle: a new Session with ONLY user-typed marker text
            # must not be counted as native experiment exposure.
            spoof=s.session("reader")
            spoof_job=secrets.token_hex(8)
            request(host,"POST",f"/api/session/{spoof}/prompt",
                    {"text":MARKER+"\\nLOOM_HARNESS_JOB:"+spoof_job})
            idle(host,[spoof])
            require(model_requests_for(root,spoof_job), "Spoofed user marker never reached model input")
            try:
                provider_observation(root,spoof_job,False,host,spoof,candidate_text)
            except RuntimeError as error:
                require("NATIVE_USER_TEXT_CONTAMINATED" in str(error),
                        "Spoofed marker failed for an unrelated cause: "+str(error))
            else:
                raise RuntimeError("FAIL_OPEN: user-typed marker was accepted as native treatment")
            report["checks"].append("user-authored-marker-cannot-qualify-native-exposure")

            # Native ancestry never enrolls an experiment: only the child's own
            # verified original source, separate approval and tool call can do
            # so. Exercise an actual child and an unassigned sibling with the
            # same registered agent and same project.
            def child_session(label):
                info=request(host,"POST","/api/session",{
                    "parentID":treatment, "agent":"question-reader",
                    "title":"Disposable "+label, "model":{"providerID":"question-fixture","id":"reader"},
                    "location":{"directory":str(project)},
                })
                require(info.get("parentID")==treatment and isinstance(info.get("id"),str),
                        "Native child relationship not established")
                return info["id"]

            child=child_session("enrolled child")
            sibling=child_session("unassigned sibling")
            require(native_entries(host,child)==[] and native_entries(host,sibling)==[],
                    "Native Session ancestry installed a treatment without explicit assignment")
            s.command(child,"return await tools.loom.agents({})")
            source_messages=request(host,"GET",f"/api/session/{child}/message?order=desc&limit=100")
            source=[m for m in source_messages
                    if m.get("type")=="user" and
                    str(m.get("text","")).startswith("LOOM_HARNESS_JOB:")]
            require(source and isinstance(source[-1].get("id"),str),
                    "Native child original user source unavailable")
            child_obj=s.invoke(child,"objective",{
                "operation":"create","source_type":"native-message","source_id":source[-1]["id"],
                "label":"Explicit child-only objective", "unit_key":"eligible-child",
            })
            child_approval=(f'LOOM-TRIAL-APPROVE candidate={proposal["id"]} '
                            f'objective={child_obj["id"]} budget=6')
            request(host,"POST",f"/api/session/{child}/prompt",{"text":child_approval})
            native_wait(host,child)
            approval_id=exact_message(host,child,child_approval)
            child_trial=s.invoke(child,"tweak",{
                "operation":"live-start","objective_id":child_obj["id"],"candidate_id":proposal["id"],
                "authorize":True,"authorization_ref":approval_id,
                "eligibility":"Exactly verified child, never inferred from parent Session",
                "evaluation_criteria":"Actual provider input differs from sibling and preserves original objective",
                "preserved_guarantees":"Native permission/billing and reviewer independence unchanged",
                "budget_requests":6,
                "expires_at":__import__("datetime").datetime.fromtimestamp(
                    time.time()+3500,__import__("datetime").timezone.utc).isoformat(),
            })
            require(child_trial.get("status")=="assigned" and native_entries(host,sibling)==[],
                    "Child enrollment or sibling isolation failed")
            child_job=ordinary_prompt(s,child,"explicit-child",hold="after")
            sibling_job=ordinary_prompt(s,sibling,"unassigned-sibling",hold="after")
            for job in (child_job,sibling_job):
                s.await_event(lambda e,j=job:e["type"]=="provider-held" and e["data"].get("job")==j)
            s.release(child_job)
            s.release(sibling_job)
            for sid in (child,sibling):
                native_wait(host,sid)
            provider_observation(root,child_job,True,host,child,candidate_text)
            provider_observation(root,sibling_job,False,host,sibling,candidate_text)
            report["checks"].append("explicit-eligible-child-and-unassigned-sibling-isolation")

            # Interruption can arrive AFTER the provider received the
            # candidate; it must never be called an unexercised control, and
            # the native entry must remain until explicit withdrawal.
            held_job=ordinary_prompt(s,child,"child-interruption",hold="after")
            s.await_event(lambda e:e["type"]=="provider-held" and
                          e["data"].get("job")==held_job)
            interrupted=request(host,"POST",f"/api/session/{child}/interrupt")
            require(interrupted.get("interrupted") is True,
                    "Native interruption was not accepted while provider input was in flight")
            s.release(held_job)
            native_wait(host,child)
            provider_observation(root,held_job,True,host,child,candidate_text)
            require(native_entries(host,child)==[{"key":KEY,"value":candidate_text}],
                    "Native Session interruption removed a durable assigned candidate")
            report["checks"].append("native-interruption-preserves-possible-exposure")
            stopped_child=s.invoke(child,"tweak",{"operation":"live-stop"})
            require(stopped_child.get("status")=="stopped" and
                    stopped_child.get("control_eligible") is False and
                    native_entries(host,child)==[],
                    "Explicit child withdrawal incorrectly cleansed history or retained native entry")
            report["checks"].append("explicit-child-withdrawal-no-clean-control")

            # Native source/entry freshness remains load-bearing on *every*
            # admitted request. A changed native value must prevent transport,
            # retain the source-linked partial history and require operator
            # recovery; it must never count as a clean control or treatment.
            drift=s.session("reader")
            s.command(drift,"return await tools.loom.agents({})")
            source_rows=request(host,"GET",f"/api/session/{drift}/message?order=desc&limit=100")
            source_drift=[m for m in source_rows
                          if m.get("type")=="user" and
                          str(m.get("text","")).startswith("LOOM_HARNESS_JOB:")]
            require(source_drift,"Source for drift test was not observed")
            drift_obj=s.invoke(drift,"objective",{
                "operation":"create","source_type":"native-message",
                "source_id":source_drift[-1]["id"],
                "label":"Reject changed native Session instruction identity",
                "unit_key":"entry-drift-test",
            })
            drift_approval=(f'LOOM-TRIAL-APPROVE candidate={proposal["id"]} '
                            f'objective={drift_obj["id"]} budget=3')
            request(host,"POST",f"/api/session/{drift}/prompt",{"text":drift_approval})
            native_wait(host,drift)
            drift_authorization=exact_message(host,drift,drift_approval)
            enrolled=s.invoke(drift,"tweak",{
                "operation":"live-start","objective_id":drift_obj["id"],
                "candidate_id":proposal["id"],"authorize":True,
                "authorization_ref":drift_authorization,
                "eligibility":"Only exact native Session entry remains authorized",
                "evaluation_criteria":"No provider request after native entry mutation",
                "preserved_guarantees":"No registry mutation or silent default model fallback",
                "budget_requests":3,
                "expires_at":__import__("datetime").datetime.fromtimestamp(
                    time.time()+3500,__import__("datetime").timezone.utc).isoformat(),
            })
            require(enrolled.get("status")=="assigned" and
                    native_entries(host,drift)==[{"key":KEY,"value":candidate_text}],
                    "Drift negative control was never genuinely assigned")
            different="DISPOSABLE_UNAUTHORIZED_ENTRY_REPLACEMENT"
            native_replace_entry(host,drift,different)
            require(native_entries(host,drift)==[{"key":KEY,"value":different}],
                    "Native mutation did not reach actual Session entry persistence")
            drift_job=ordinary_prompt(s,drift,"changed-entry-must-deny")
            native_wait(host,drift)
            idle(host,[drift])
            require(not model_requests_for(root,drift_job),
                    "FAIL_OPEN: changed native entry reached provider without fresh fingerprint")
            native_drift_messages=request(host,"GET",f"/api/session/{drift}/message?order=desc&limit=100")
            require(any("LOOM_LIVE_ENTRY_DRIFT" in json.dumps(m) for m in native_drift_messages),
                    "Native execution did not report exact entry drift pre-transport error")
            import sqlite3
            stores=list((root/"state/loom/actions-v1").glob("*/learning.sqlite"))
            require(len(stores)==1, "No unambiguous project-local learning history for drift test")
            with sqlite3.connect(stores[0]) as db:
                row=db.execute("SELECT status,preflight_count FROM learning_live_experiments WHERE session_id=?",
                               (drift,)).fetchone()
            require(row and row[0] in ("assigned","possible-exposure") and row[1]>=1,
                    "Drift invalidated or erased the stored trial instead of preserving uncertain history")
            report["drift"]={"native_entry_mutated":True,
                             "provider_received_changed_request":False,
                             "error":"LOOM_LIVE_ENTRY_DRIFT",
                             "trial_status_after_denial":row[0],
                             "recovery":"operator-required; not a clean control"}
            report["checks"].append("installed-native-entry-drift-denied-before-provider")
            report["status"]="QUALIFIED_BOUNDED"
    except Exception as error:
        report["status"]="UNPROVEN"
        report["blocker"]=type(error).__name__+": "+str(error)
        if "root" in locals():
            # Bounded source-reduced diagnostic: never persist full prompts,
            # tool inputs, native message bodies, or provider credentials.
            report["event_summary"] = [{
                "type":e.get("type"),
                "sessionID":e.get("data",{}).get("sessionID"),
                "agent":e.get("data",{}).get("agent"),
                "tool":e.get("data",{}).get("tool"),
                "status":e.get("data",{}).get("status"),
                "kind":e.get("data",{}).get("kind"),
                "job":e.get("data",{}).get("job"),
                "role":e.get("data",{}).get("role"),
            } for e in events(root)[-60:]]
    finally:
        if host is not None:
            host.close()
        (output / "report.json").write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--opencode",type=Path,required=True)
    parser.add_argument("--repository",type=Path,required=True)
    parser.add_argument("--plugin",type=Path,required=True)
    parser.add_argument("--artifact",type=Path,required=True)
    parser.add_argument("--expect-plugin-version",required=True)
    parser.add_argument("--report-directory",type=Path,required=True)
    parser.add_argument("--require-qualified-human-approval",action="store_true",
                        help="Opt in to full positive qualification only when the exact native host provides certified direct-human approval")
    args=parser.parse_args()
    result=run(args)
    print(json.dumps({k:result.get(k) for k in ("status","checks","stage","blocker","denial_diagnostic")},indent=2))
    if result["status"] not in ("QUALIFIED_BOUNDED","BLOCKED_PROVENANCE"):
        raise SystemExit(1)
    if result["status"]=="BLOCKED_PROVENANCE":
        require("2.2.6-user-role-orchestrator-spoof-denied-no-trial-or-entry" in result["checks"],
                "Missing installed-host no-entry/no-reservation refusal evidence")


if __name__=="__main__":
    main()
