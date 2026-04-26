import { Agent } from "@atproto/api";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import {
  NSID,
  type AuthorFollowRecord,
  type BookDismissedRecord,
  type ShelfEntryRecord,
} from "./lexicon";

export interface ListedRecord<T> {
  uri: string;
  rkey: string;
  cid?: string;
  value: T;
}

interface PutResult {
  uri: string;
  rkey: string;
  cid?: string;
}

type CollectionName = (typeof NSID)[keyof typeof NSID];
type RecordValue = ShelfEntryRecord | AuthorFollowRecord | BookDismissedRecord;

function rkeyFromUri(uri: string): string {
  const slash = uri.lastIndexOf("/");
  return slash >= 0 ? uri.slice(slash + 1) : uri;
}

/**
 * List all records in a collection on the authenticated user's repo,
 * paginating until the cursor is exhausted. Returns records in the order
 * the PDS returned them.
 */
export async function listRecords<T extends RecordValue>(
  session: OAuthSession,
  collection: CollectionName,
): Promise<ListedRecord<T>[]> {
  const agent = new Agent(session);
  const out: ListedRecord<T>[] = [];
  let cursor: string | undefined;
  do {
    const res = await agent.com.atproto.repo.listRecords({
      repo: session.did,
      collection,
      limit: 100,
      cursor,
    });
    for (const r of res.data.records) {
      out.push({
        uri: r.uri,
        rkey: rkeyFromUri(r.uri),
        cid: r.cid,
        value: r.value as unknown as T,
      });
    }
    cursor = res.data.cursor;
  } while (cursor);
  return out;
}

/**
 * Create or replace a record. When `rkey` is provided we putRecord (upsert);
 * otherwise we createRecord and the PDS assigns a tid. The returned rkey
 * should be persisted by the caller so subsequent updates target the same
 * record.
 */
export async function putRecord(
  session: OAuthSession,
  collection: CollectionName,
  record: RecordValue,
  rkey?: string,
): Promise<PutResult> {
  const agent = new Agent(session);
  const value = { ...record, $type: collection };
  if (rkey) {
    const res = await agent.com.atproto.repo.putRecord({
      repo: session.did,
      collection,
      rkey,
      record: value,
    });
    return { uri: res.data.uri, rkey, cid: res.data.cid };
  }
  const res = await agent.com.atproto.repo.createRecord({
    repo: session.did,
    collection,
    record: value,
  });
  return { uri: res.data.uri, rkey: rkeyFromUri(res.data.uri), cid: res.data.cid };
}

export async function deleteRecord(
  session: OAuthSession,
  collection: CollectionName,
  rkey: string,
): Promise<void> {
  const agent = new Agent(session);
  await agent.com.atproto.repo.deleteRecord({
    repo: session.did,
    collection,
    rkey,
  });
}
