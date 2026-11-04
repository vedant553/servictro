import { RequestStatus } from '@serviceos/contracts';
import { DomainError } from '../../../common/errors/domain.error';

/**
 * Service request state machine (Tech Spec §12.1).
 *
 *   new → triaged → accepted → converted → closed
 *            ↘ needs_information ↗   ↘ rejected → closed
 *
 * Every transition is validated server-side; the API is the only authority.
 */
export const REQUEST_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  new: ['triaged', 'rejected', 'closed'],
  triaged: ['accepted', 'needs_information', 'rejected', 'closed'],
  needs_information: ['triaged', 'rejected', 'closed'],
  accepted: ['converted', 'closed', 'rejected'],
  converted: ['closed'],
  rejected: ['closed'],
  closed: [],
};

export function assertRequestTransition(from: RequestStatus, to: RequestStatus): void {
  if (from === to) {
    throw new DomainError('REQUEST_SAME_STATE', `Request is already ${from}`, 409);
  }
  if (!REQUEST_TRANSITIONS[from]?.includes(to)) {
    throw new DomainError(
      'REQUEST_INVALID_TRANSITION',
      `Cannot move a request from ${from} to ${to}`,
      409,
    );
  }
}
