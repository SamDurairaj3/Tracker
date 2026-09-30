import type { WorkItemRow } from './rows';
type SeedWorkItem = Omit<
  WorkItemRow,
  | 'due_label'
  | 'work_type'
  | 'purpose'
  | 'expected_result'
  | 'linked_goal'
  | 'progress_method'
  | 'blocker'
  | 'created_at'
  | 'updated_at'
  | 'archived_at'
  | 'archived_by_user_id'
  | 'archived_by_name'
  | 'activity_count'
  | 'latest_activity_at'
> & {
  blocker?: string;
};

export const seededWorkItems: SeedWorkItem[] = [
  { id: 'PROP-148', title: 'Define acceptance limits for chamber pressure oscillation', team: 'Propulsion', owner: 'Arjun Menon', status: 'captured', health: 'at-risk', priority: 'High', progress: 5, start_date: '2026-08-29', due_date: '2026-09-08', created_by: 'Meera Shah' },
  { id: 'GND-041', title: 'Confirm test-stand purge sequence instrumentation', team: 'Ground Systems', owner: 'Vikram Rao', status: 'captured', health: 'on-track', priority: 'Medium', progress: 0, start_date: '2026-08-30', due_date: '2026-09-11', created_by: 'Vikram Rao' },
  { id: 'AVN-071', title: 'Release telemetry harness interface drawing', team: 'Avionics', owner: 'Riya Das', status: 'ready', health: 'on-track', priority: 'High', progress: 10, start_date: '2026-08-28', due_date: '2026-09-04', created_by: 'Riya Das' },
  { id: 'STR-093', title: 'Prepare interstage modal-test article', team: 'Structures', owner: 'Neha Iyer', status: 'ready', health: 'at-risk', priority: 'Critical', progress: 12, start_date: '2026-08-25', due_date: '2026-09-02', created_by: 'Kabir Singh' },
  { id: 'GNC-056', title: 'Update actuator rate-limit assumptions in SIL model', team: 'GNC', owner: 'Kabir Singh', status: 'ready', health: 'on-track', priority: 'Medium', progress: 8, start_date: '2026-09-01', due_date: '2026-09-09', created_by: 'Kabir Singh' },
  { id: 'PROP-142', title: 'Validate injector pressure-drop model against cold-flow data', team: 'Propulsion', owner: 'Arjun Menon', status: 'active', health: 'on-track', priority: 'Critical', progress: 68, start_date: '2026-08-18', due_date: '2026-09-01', created_by: 'Arjun Menon' },
  { id: 'STR-089', title: 'Close composite tank-support load cases', team: 'Structures', owner: 'Neha Iyer', status: 'active', health: 'blocked', priority: 'Critical', progress: 44, start_date: '2026-08-19', due_date: '2026-08-31', created_by: 'Neha Iyer', blocker: 'Awaiting revised interface loads from Propulsion.' },
  { id: 'FSW-038', title: 'Implement loss-of-telemetry safe-state transition', team: 'Flight Software', owner: 'Asha Nair', status: 'active', health: 'at-risk', priority: 'High', progress: 52, start_date: '2026-08-22', due_date: '2026-09-03', created_by: 'Asha Nair' },
  { id: 'GND-037', title: 'Complete LOX fill-line pressure test', team: 'Ground Systems', owner: 'Vikram Rao', status: 'active', health: 'blocked', priority: 'High', progress: 35, start_date: '2026-08-24', due_date: '2026-08-30', created_by: 'Vikram Rao', blocker: 'Replacement pressure transducer has not arrived.' },
  { id: 'AVN-063', title: 'Resolve flight-computer harness routing conflict', team: 'Avionics', owner: 'Riya Das', status: 'active', health: 'blocked', priority: 'Critical', progress: 61, start_date: '2026-08-17', due_date: '2026-08-29', created_by: 'Riya Das', blocker: 'Mechanical envelope decision is pending.' },
  { id: 'GNC-049', title: 'Review navigation filter performance with sensor dropouts', team: 'GNC', owner: 'Kabir Singh', status: 'review', health: 'on-track', priority: 'High', progress: 92, start_date: '2026-08-21', due_date: '2026-08-31', created_by: 'Kabir Singh' },
  { id: 'STR-087', title: 'Close interstage quasi-static load review', team: 'Structures', owner: 'Neha Iyer', status: 'review', health: 'at-risk', priority: 'High', progress: 88, start_date: '2026-08-20', due_date: '2026-08-28', created_by: 'Neha Iyer' },
  { id: 'PROP-136', title: 'Archive hot-fire anomaly disposition evidence', team: 'Propulsion', owner: 'Meera Shah', status: 'review', health: 'on-track', priority: 'Medium', progress: 95, start_date: '2026-08-23', due_date: '2026-09-01', created_by: 'Meera Shah' },
  { id: 'AVN-058', title: 'Bench-verify power distribution fault telemetry', team: 'Avionics', owner: 'Riya Das', status: 'done', health: 'on-track', priority: 'High', progress: 100, start_date: '2026-08-19', due_date: '2026-08-27', created_by: 'Riya Das' },
  { id: 'FSW-034', title: 'Baseline guidance command message schema', team: 'Flight Software', owner: 'Asha Nair', status: 'done', health: 'on-track', priority: 'Medium', progress: 100, start_date: '2026-08-18', due_date: '2026-08-26', created_by: 'Asha Nair' },
];

export const seededChecklist = [
  { id: 'STEP-PROP142-1', workItemId: 'PROP-142', title: 'Normalize cold-flow test data', assignee: 'Arjun Menon', due: '2026-08-25', status: 'done' as const },
  { id: 'STEP-PROP142-2', workItemId: 'PROP-142', title: 'Run pressure-drop correlation', assignee: 'Arjun Menon', due: '2026-09-01', status: 'in-progress' as const },
  { id: 'STEP-PROP142-3', workItemId: 'PROP-142', title: 'Review residuals against acceptance band', assignee: 'Meera Shah', due: '2026-09-03', status: 'open' as const },
  { id: 'STEP-PROP148-1', workItemId: 'PROP-148', title: 'Collect oscillation limits from test reports', assignee: 'Arjun Menon', due: '2026-09-04', status: 'open' as const },
  { id: 'STEP-PROP148-2', workItemId: 'PROP-148', title: 'Confirm controls margin with GNC', assignee: 'Kabir Singh', due: null, status: 'open' as const },
  { id: 'STEP-STR089-1', workItemId: 'STR-089', title: 'Supply revised propulsion interface loads', assignee: 'Arjun Menon', due: '2026-08-30', status: 'blocked' as const },
  { id: 'STEP-STR087-1', workItemId: 'STR-087', title: 'Review propulsion-side load assumptions', assignee: 'Arjun Menon', due: '2026-08-28', status: 'in-progress' as const },
];


