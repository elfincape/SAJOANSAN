import type { Profile } from '../lib/auth';
import type { PortalTask, ParticipantSubject } from './portal-types';
export function assignedToMe(
  task: PortalTask,
  profile: Profile,
  participants: ParticipantSubject[],
) {
  if (task.owner_id === profile.id) return true;
  const subject = participants.find((s) => s.id === task.handler_subject_id),
    person = participants.find((s) => s.user_id === profile.id);
  return (
    (subject?.kind === 'role' &&
      subject.role_key === 'delivery_team' &&
      profile.role === 'admin') ||
    (subject?.kind === 'center' &&
      (person?.centers ?? []).includes(subject.center_code || ''))
  );
}
