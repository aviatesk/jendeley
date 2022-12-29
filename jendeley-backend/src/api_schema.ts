// This file is shared between client and server

type IDType = "doi" | "isbn" | "url" | "book" | "arxiv" | "path";

type Entry = {
  id: string;
  idType: IDType;
  url: string | undefined;
  title: string;
  path: string | undefined;
  tags: string[];
  comments: string;
  authors: string[];
  abstract: string;
  year: number | undefined;
  publisher: string | undefined;
};

type DB = Entry[];

type RequestGetPdfFromUrl = {
  url: string;
  title: string | undefined;
  doi: string | undefined;
  isbn: string | undefined;
  tags: string[];
  comments: string;
};

type RequestGetWebFromUrl = {
  url: string;
  title: string;
  tags: string[];
  comments: string;
};

export type { IDType, Entry, DB, RequestGetPdfFromUrl, RequestGetWebFromUrl };
export {};
