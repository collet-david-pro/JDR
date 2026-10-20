import { mbInputToBytes } from './format';
import type { User } from './types';

export interface UserFormValues {
  readonly username: string;
  readonly email: string;
  readonly role: string;
  /** Quota in Mo; "" = site default (null). */
  readonly quotaMb: string;
}

/** PATCH /admin/users/{id} body: changed fields only; an empty quota resets it to null. */
export function buildUserPatch(user: User, values: UserFormValues): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (values.username.trim() !== user.username) patch['username'] = values.username.trim();
  if (values.email.trim() !== user.email) patch['email'] = values.email.trim();
  if (values.role !== user.role) patch['role'] = values.role;
  const quota = mbInputToBytes(values.quotaMb);
  if (quota !== undefined && quota !== user.storage_quota_bytes) {
    // Unchanged display of a non-round byte value must not rewrite it.
    const sameDisplay =
      quota !== null &&
      user.storage_quota_bytes !== null &&
      Math.abs(quota - user.storage_quota_bytes) < 1024 * 1024 * 0.01;
    if (!sameDisplay) patch['storage_quota_bytes'] = quota;
  }
  return patch;
}
