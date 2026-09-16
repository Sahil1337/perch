import type { FileEntry } from "@perch/protocol";
import type { CallOptions, Transport } from "./http";

export type FileContent = { path: string; content: string; modifiedAt: string };
export type FileWritten = { path: string; modifiedAt: string };

export type WriteInput = {
  path: string;
  content: string;
  /**
   * The `modifiedAt` the content was read at. When it no longer matches disk the write is
   * refused with a 409 — call `staleWrite(err)` to get the current file back out of the error.
   */
  ifModifiedAt?: string;
};

export type FilesApi = {
  /** Without a dir, hands back the workspace roots themselves. */
  list(dir?: string, opts?: CallOptions): Promise<FileEntry[]>;
  read(path: string, opts?: CallOptions): Promise<FileContent>;
  write(input: WriteInput, opts?: CallOptions): Promise<FileWritten>;
  create(dir: string, name: string, opts?: CallOptions): Promise<FileEntry>;
  remove(path: string, opts?: CallOptions): Promise<boolean>;
  rename(path: string, name: string, opts?: CallOptions): Promise<FileEntry>;
};

export function filesApi(http: Transport): FilesApi {
  return {
    list: (dir, opts) =>
      http.json<FileEntry[]>("/api/files", { query: { dir }, signal: opts?.signal }),

    read: (path, opts) =>
      http.json<FileContent>("/api/files/content", { query: { path }, signal: opts?.signal }),

    write: (input, opts) =>
      http.json<FileWritten>("/api/files/content", {
        method: "PUT",
        body: input,
        signal: opts?.signal,
      }),

    create: (dir, name, opts) =>
      http.json<FileEntry>("/api/files", {
        method: "POST",
        body: { dir, name },
        signal: opts?.signal,
      }),

    remove: async (path, opts) =>
      (
        await http.json<{ ok: boolean }>("/api/files", {
          method: "DELETE",
          query: { path },
          signal: opts?.signal,
        })
      ).ok,

    rename: (path, name, opts) =>
      http.json<FileEntry>("/api/files/rename", {
        method: "POST",
        body: { path, name },
        signal: opts?.signal,
      }),
  };
}
