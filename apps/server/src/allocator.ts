import { DurableObject } from 'cloudflare:workers';
import { Commitment, GroupManager } from '@mishna/domain';
import { D1GroupRepository } from './repository';
import { calendar, idGen, structure } from './domain';

// ---------------------------------------------------------------------------
// AllocatorDO
//
// The single write path for group allocation. The main worker forwards every
// join/leave to ONE instance (idFromName("allocator")), and this object runs
// them through an in-process promise chain so the load->mutate->save cycle is
// strictly serialized. That closes the race the domain README hand-waves: two
// simultaneous joins can't both read the same tail and double-allocate it.
//
// (Durable Objects don't serialize across `await` boundaries on their own once
// external I/O like D1 is involved, so the explicit chain is what guarantees
// it.) Reads — assignments, /me, admin — bypass this and hit D1 directly.
// ---------------------------------------------------------------------------

interface JoinBody {
  userId: string;
  commitment: Commitment;
}

interface LeaveBody {
  userId: string;
}

export class AllocatorDO extends DurableObject<Env> {
  /** Tail of the serialization chain; each op runs after the previous settles. */
  private chain: Promise<unknown> = Promise.resolve();

  /** Queues `fn` to run after all previously-queued ops, serialized. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn, fn);
    // Swallow rejection on the chain so one failed op doesn't poison the next.
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private manager(): GroupManager {
    const repo = new D1GroupRepository(this.env.DB, structure, idGen);
    return new GroupManager(repo, calendar);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/join') {
      const body = (await request.json()) as JoinBody;
      return this.serialize(() => this.join(body.userId, body.commitment));
    }
    if (url.pathname === '/leave') {
      const body = (await request.json()) as LeaveBody;
      return this.serialize(() => this.leave(body.userId));
    }
    return new Response('Not found', { status: 404 });
  }

  private async join(userId: string, commitment: Commitment): Promise<Response> {
    const existing = await this.env.DB.prepare(
      'SELECT 1 FROM participants WHERE user_id = ?',
    )
      .bind(userId)
      .first();
    if (existing) {
      return Response.json({ error: 'already joined' }, { status: 409 });
    }

    await this.manager().join(userId, commitment, new Date());

    await this.env.DB.prepare(
      'INSERT INTO participants (user_id, commitment, joined_at) VALUES (?, ?, ?)',
    )
      .bind(userId, commitment, Date.now())
      .run();

    return Response.json({ joined: true, commitment });
  }

  private async leave(userId: string): Promise<Response> {
    await this.manager().removeUser(userId);
    await this.env.DB.prepare('DELETE FROM participants WHERE user_id = ?')
      .bind(userId)
      .run();
    return Response.json({ joined: false });
  }
}
