import { randomUUID } from 'node:crypto';

const COOKIE_NAME = 'karigar.sid';

export class SessionStore {
  constructor() {
    this.sessions = new Map();
  }

  create(payload = {}) {
    const id = randomUUID();
    const session = { ...payload };
    this.sessions.set(id, session);
    const header = `${COOKIE_NAME}=${id}; Path=/; HttpOnly; SameSite=Lax`;
    return { id, header, session };
  }

  get(sid) {
    return this.sessions.get(sid);
  }

  destroy(sid) {
    this.sessions.delete(sid);
  }
}
