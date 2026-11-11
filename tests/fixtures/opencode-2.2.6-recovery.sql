-- Minimal external storage fixture, not an installed-host proof.
-- Column representation and migration IDs: anomalyco/opencode v2.2.6 dc2ffcf8.
CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL);
CREATE TABLE session_v2 (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT);
CREATE TABLE instruction_entry (
 session_id TEXT NOT NULL REFERENCES session_v2(id), key TEXT NOT NULL,
 value TEXT, removed INTEGER NOT NULL DEFAULT false,
 time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
 PRIMARY KEY (session_id, key)
);
CREATE TABLE instruction_state (
 session_id TEXT PRIMARY KEY REFERENCES session_v2(id),
 epoch_start INTEGER NOT NULL, through_seq INTEGER NOT NULL,
 initial_values TEXT NOT NULL, current_values TEXT NOT NULL
);
INSERT INTO migration VALUES ('20260127222353_familiar_lady_ursula', 1);
INSERT INTO migration VALUES ('20260211171708_add_project_commands', 1);
INSERT INTO migration VALUES ('20260213144116_wakeful_the_professor', 1);
INSERT INTO migration VALUES ('20260225215848_workspace', 1);
INSERT INTO migration VALUES ('20260227213759_add_session_workspace_id', 1);
INSERT INTO migration VALUES ('20260228203230_blue_harpoon', 1);
INSERT INTO migration VALUES ('20260303231226_add_workspace_fields', 1);
INSERT INTO migration VALUES ('20260309230000_move_org_to_state', 1);
INSERT INTO migration VALUES ('20260312043431_session_message_cursor', 1);
INSERT INTO migration VALUES ('20260323234822_events', 1);
INSERT INTO migration VALUES ('20260410174513_workspace-name', 1);
INSERT INTO migration VALUES ('20260413175956_chief_energizer', 1);
INSERT INTO migration VALUES ('20260423070820_add_icon_url_override', 1);
INSERT INTO migration VALUES ('20260427172553_slow_nightmare', 1);
INSERT INTO migration VALUES ('20260428004200_add_session_path', 1);
INSERT INTO migration VALUES ('20260501142318_next_venus', 1);
INSERT INTO migration VALUES ('20260504145000_add_sync_owner', 1);
INSERT INTO migration VALUES ('20260507164347_add_workspace_time', 1);
INSERT INTO migration VALUES ('20260510033149_session_usage', 1);
INSERT INTO migration VALUES ('20260511000411_data_migration_state', 1);
INSERT INTO migration VALUES ('20260511173437_session-metadata', 1);
INSERT INTO migration VALUES ('20260601010001_normalize_storage_paths', 1);
INSERT INTO migration VALUES ('20260601202201_amazing_prowler', 1);
INSERT INTO migration VALUES ('20260602002951_lowly_union_jack', 1);
INSERT INTO migration VALUES ('20260602182828_add_project_directories', 1);
INSERT INTO migration VALUES ('20260603001617_session_message_projection_indexes', 1);
INSERT INTO migration VALUES ('20260603040000_session_message_projection_order', 1);
INSERT INTO migration VALUES ('20260603141458_session_input_inbox', 1);
INSERT INTO migration VALUES ('20260603160727_jittery_ezekiel_stane', 1);
INSERT INTO migration VALUES ('20260604172448_event_sourced_session_input', 1);
INSERT INTO migration VALUES ('20260605003541_add_session_context_snapshot', 1);
INSERT INTO migration VALUES ('20260605042240_add_context_epoch_agent', 1);
INSERT INTO migration VALUES ('20260611035744_credential', 1);
INSERT INTO migration VALUES ('20260611192811_lush_chimera', 1);
INSERT INTO migration VALUES ('20260612174303_project_dir_strategy', 1);
INSERT INTO migration VALUES ('20260622142730_simplify_session_context_epoch', 1);
INSERT INTO migration VALUES ('20260622170816_reset_v2_session_state', 1);
INSERT INTO migration VALUES ('20260622202450_simplify_session_input', 1);
INSERT INTO migration VALUES ('20260804233008_loose_psylocke', 1);
INSERT INTO migration VALUES ('20260805200742_import_legacy_credentials', 1);
INSERT INTO migration VALUES ('20260808023530_workspace_domain', 1);
INSERT INTO migration VALUES ('20260811161259_execution_claim_attempts', 1);
INSERT INTO migration VALUES ('20260812181746_session_inbox', 1);
INSERT INTO migration VALUES ('20260812213948_worktree', 1);
INSERT INTO migration VALUES ('20260819222447_session_viewed_state', 1);
INSERT INTO migration VALUES ('20260823191254_nullable_workspace_binding', 1);
INSERT INTO migration VALUES ('20260910120000_clear_v1_session_permission', 1);
INSERT INTO migration VALUES ('20260923013825_project_time_active', 1);
INSERT INTO migration VALUES ('20261007190000_azure_cli_external_credential', 1);
INSERT INTO migration VALUES ('20261010180456_project_time_archived', 1);
INSERT INTO migration VALUES ('20261024002554_session_allowance', 1);
INSERT INTO migration VALUES ('20261024175301_drop_session_allowance', 1);
INSERT INTO migration VALUES ('20261025123711_blob', 1);
INSERT INTO migration VALUES ('20261025154125_drop_session_pending', 1);
INSERT INTO migration VALUES ('20261026223005_schedule', 1);
INSERT INTO migration VALUES ('20261029002625_session_part', 1);
INSERT INTO migration VALUES ('20261029073502_session_time_busy', 1);
INSERT INTO migration VALUES ('20261029165540_schedule_checks', 1);
INSERT INTO migration VALUES ('20261030054400_job', 1);
