import fs from "fs";
import path from "path";
import pdfparse from "pdf-parse";
import node_isbn from "node-isbn";
import xml2js from "xml2js";
import crypto from "crypto";
import { PDFExtract, PDFExtractOptions } from "pdf.js-extract";
import { logger } from "./logger";
import { JENDELEY_NO_ID, JENDELEY_NO_TRACK } from "./constants";

function walkPDFDFS(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  } else if (fs.lstatSync(dir).isDirectory()) {
    const ds = fs.readdirSync(dir, { withFileTypes: true });
    var ret: Array<string> = [];
    ds.forEach((d) => {
      ret = ret.concat(walkPDFDFS(path.join(dir, d.name)));
    });
    return ret;
  } else if (path.extname(dir) == ".pdf" && !dir.includes("_Note")) {
    // TODO: Ignore general pattern
    return [dir];
  } else {
    return [];
  }
}

// All paths returned from walkPDF are relative path from papers_dir.
function walkPDF(papers_dir: string): string[] {
  let r: string[] = [];
  const pdfs = walkPDFDFS(papers_dir);
  for (const pd of pdfs) {
    r.push(pd.replace(papers_dir, ""));
  }
  return r;
}

type DocID = {
  doi: string | null;
  isbn: string | null;
  arxiv: string | null;
  path: string | null;
};

function getDocIDFromTexts(texts: [string]): DocID {
  const regexpDOI = new RegExp(
    '(10[.][0-9]{2,}(?:[.][0-9]+)*/(?:(?![%"#? ])\\S)+)',
    "g"
  );
  const regexpArxivDOI = new RegExp("(arXiv:[0-9]{4}[.][0-9]{4,5})", "g");
  const regexpISBN = new RegExp(
    "(?:ISBN(?:-1[03])?:? )?(?=[0-9X]{10}|(?=(?:[0-9]+[- ]){3})[- 0-9X]{13}|97[89][0-9]{10}|(?=(?:[0-9]+[- ]){4})[- 0-9]{17})(?:97[89][- ]?)?[0-9]{1,5}[- ]?[0-9]+[- ]?[0-9]+[- ]?[0-9X]",
    "g"
  );

  let doi: string | null = null;
  let arxiv: string | null = null;
  for (const text of texts) {
    const foundDOI = [...text.matchAll(regexpDOI)];
    for (const f of foundDOI) {
      let d = f[0] as string;
      if (d.charAt(d.length - 1) == ".") {
        d = d.substr(0, d.length - 1);
      }
      // Hack for POPL
      d = d.replace("10.1145/http://dx.doi.org/", "");
      doi = d;
      break;
    }
    if (doi != null) break;

    const foundArxivDOI = [...text.matchAll(regexpArxivDOI)];
    for (const f of foundArxivDOI) {
      const d = f[0] as string;
      arxiv = d.substring(6);
      break;
    }
    if (arxiv != null) break;
  }

  let isbn: string | null = null;
  for (const text of texts) {
    const foundISBN = [...text.matchAll(regexpISBN)];
    for (const f of foundISBN) {
      let d = f[0] as string;
      let n = "";
      for (const c of d) {
        if (("0" <= c && c <= "9") || c == "X") {
          n += c;
        }
      }

      if (n.length == 10) {
        const invalid = new RegExp(
          "(0000000000)|(1111111111)|(2222222222)|(3333333333)|(4444444444)|(5555555555)|(6666666666)|(7777777777)|(8888888888)|(9999999999)",
          "g"
        );
        const foundInvalid = [...n.matchAll(invalid)];
        if (foundInvalid.length != 0) {
          continue;
        }

        let cd = 0;
        for (let i = 0; i < 9; i++) {
          cd += (10 - i) * (n.charCodeAt(i) - "0".charCodeAt(0));
        }
        cd = 11 - (cd % 11);
        const cd_c =
          cd == 10 ? "X" : String.fromCharCode("0".charCodeAt(0) + cd);
        if (cd_c == n[9]) {
          isbn = n;
        }
      } else if (
        n.length == 13 &&
        (n.substring(0, 3) == "978" || n.substring(0, 3) == "979")
      ) {
        let cd = 0;
        for (let i = 0; i < 12; i++) {
          if (i % 2 == 0) {
            cd += n.charCodeAt(i) - "0".charCodeAt(0);
          } else {
            cd += (n.charCodeAt(i) - "0".charCodeAt(0)) * 3;
          }
        }
        cd = 10 - (cd % 10);
        const cd_c = String.fromCharCode("0".charCodeAt(0) + cd);
        if (cd_c == n[12]) {
          isbn = n;
        }
      }
      break;
    }
    if (isbn != null) break;
  }

  return { doi: doi, isbn: isbn, arxiv: arxiv, path: null };
}

function getDocIDFromUrl(url: string): DocID | null {
  const regexpArxiv = new RegExp(
    "https://arxiv[.]org/pdf/([0-9]{4}[.][0-9]{4,5})[.]pdf",
    "g"
  );
  const foundArxiv = [...url.matchAll(regexpArxiv)];
  for (const f of foundArxiv) {
    return { doi: null, isbn: null, arxiv: f[1], path: null };
  }
  return null;
}

function getDocIDManuallyWritten(pdf: string): DocID | null {
  const regexpDOI1 = new RegExp(
    "(doi_10_[0-9]{4}_[0-9]{4,}([_-][0-9()-]{6,})?)",
    "g"
  );
  const foundDOI1 = [...pdf.matchAll(regexpDOI1)];
  for (const f of foundDOI1) {
    let d = (f[0] as string).substring(4);
    d =
      d.substring(0, 2) +
      "." +
      d.substring(3, 3 + 4) +
      "/" +
      d.substring(3 + 4 + 1);
    d = d.replaceAll("_", ".");
    return { doi: d, isbn: null, arxiv: null, path: null };
  }

  const regexpDOI2 = new RegExp(
    "(doi_10_[0-9]{4}_[A-Z]{1,3}[0-9]+[0-9X])",
    "g"
  );
  const foundDOI2 = [...pdf.matchAll(regexpDOI2)];
  for (const f of foundDOI2) {
    let d = (f[0] as string).substring(4);
    d =
      d.substring(0, 2) +
      "." +
      d.substring(3, 3 + 4) +
      "/" +
      d.substring(3 + 4 + 1);
    d = d.replaceAll("_", ".");
    return { doi: d, isbn: null, arxiv: null, path: null };
  }

  const regexpDOI3 = new RegExp(
    "(doi_10_[0-9]{4}_[a-zA-z]+_[0-9]+_[0-9]+)",
    "g"
  );
  const foundDOI3 = [...pdf.matchAll(regexpDOI3)];
  for (const f of foundDOI3) {
    let d = (f[0] as string).substring(4);
    d =
      d.substring(0, 2) +
      "." +
      d.substring(3, 3 + 4) +
      "/" +
      d.substring(3 + 4 + 1);
    d = d.replaceAll("_", ".");
    return { doi: d, isbn: null, arxiv: null, path: null };
  }

  const regexpDOI4 = new RegExp("(doi_10_[0-9]{4}_[0-9X-]+_[0-9]{1,})", "g");
  const foundDOI4 = [...pdf.matchAll(regexpDOI4)];
  for (const f of foundDOI4) {
    let d = (f[0] as string).substring(4);
    d =
      d.substring(0, 2) +
      "." +
      d.substring(3, 3 + 4) +
      "/" +
      d.substring(3 + 4 + 1);
    return { doi: d, isbn: null, arxiv: null, path: null };
  }

  const regexpDOI6 = new RegExp(
    "(doi_10_[0-9]{4}_[a-zA-z]+-[0-9]+-[0-9]+)",
    "g"
  );
  const foundDOI6 = [...pdf.matchAll(regexpDOI6)];
  for (const f of foundDOI6) {
    let d = (f[0] as string).substring(4);
    d =
      d.substring(0, 2) +
      "." +
      d.substring(3, 3 + 4) +
      "/" +
      d.substring(3 + 4 + 1);
    d = d.replaceAll("_", ".");
    return { doi: d, isbn: null, arxiv: null, path: null };
  }

  const regexpDOI7 = new RegExp("(doi_10_[0-9]{4}_978-[0-9-]+)", "g");
  const foundDOI7 = [...pdf.matchAll(regexpDOI7)];
  for (const f of foundDOI7) {
    let d = (f[0] as string).substring(4);
    d =
      d.substring(0, 2) +
      "." +
      d.substring(3, 3 + 4) +
      "/" +
      d.substring(3 + 4 + 1);
    d = d.replaceAll("_", ".");
    return { doi: d, isbn: null, arxiv: null, path: null };
  }

  const regexpISBN = new RegExp("(isbn_[0-9]{10,})", "g");
  const foundISBN = [...pdf.matchAll(regexpISBN)];
  for (const f of foundISBN) {
    let d = (f[0] as string).substring(5);
    return { doi: null, isbn: d, arxiv: null, path: null };
  }

  if (
    path.basename(pdf, ".pdf").endsWith("no_id") ||
    pdf.includes(JENDELEY_NO_ID)
  ) {
    return {
      doi: null,
      isbn: null,
      arxiv: null,
      path: pdf,
    };
  }

  return null;
}

function getTitleFromPath(pdf: string): string {
  const basename = path.basename(pdf, ".pdf");
  let r = "";
  let level = 0;
  for (let i = 0; i < basename.length; i++) {
    if (basename[i] == "[") level += 1;
    else if (basename[i] == "]") level -= 1;
    else if (level == 0 && (r != "" || basename[i] != " ")) r += basename[i];
  }
  return r;
}

async function getTitleFromPDF(
  pdf: string,
  papers_dir: string
): Promise<string | null> {
  const pdfExtract = new PDFExtract();
  const options: PDFExtractOptions = {}; /* see below */
  const data = await pdfExtract.extract(path.join(papers_dir, pdf), options);
  if (
    data["meta"] != null &&
    data["meta"]["metadata"] != null &&
    data["meta"]["metadata"]["dc:title"] != null
  ) {
    const title = data["meta"]["metadata"]["dc:title"];
    logger.info("getTitleFromPDF(" + pdf + ", " + papers_dir + ") = " + title);
    return title;
  } else if (
    data["meta"] != null &&
    data["meta"]["info"] != null &&
    data["meta"]["info"]["Title"] != null
  ) {
    const title = data["meta"]["info"]["Title"];
    logger.info("getTitleFromPDF(" + pdf + ", " + papers_dir + ") = " + title);
    return title;
  } else {
    logger.info("getTitleFromPDF(" + pdf + ", " + papers_dir + ") = null");
    return null;
  }
}

async function getDocIDFromTitle(
  pdf: string,
  papers_dir: string
): Promise<DocID | null> {
  let titles: string[] = [];
  const title_from_pdf = await getTitleFromPDF(pdf, papers_dir);
  if (
    title_from_pdf != null &&
    path.extname(title_from_pdf) != ".dvi" &&
    path.extname(title_from_pdf) != ".pdf"
  ) {
    titles.push(title_from_pdf);
  }

  let { got } = await import("got");

  for (const title of titles) {
    logger.info("getDocIDFromTitle title = " + title);
    const URL =
      "https://api.crossref.org/v1/works?query.bibliographic=" +
      title.replaceAll(" ", "+");
    const options = { headers: { Accept: "application/json" } };
    try {
      const data = (await got(URL, options).json()) as Object;
      const n_item = data["message"]["items"].length;
      for (let i = 0; i < n_item; i++) {
        const t = data["message"]["items"][i]["title"][0].toLowerCase();
        if (title.toLowerCase() == t) {
          logger.info("title = " + title + " t = " + t);
          const doi = data["message"]["items"][i]["DOI"];
          return { doi: doi, isbn: null, arxiv: null, path: null };
        }
      }
    } catch {
      logger.warn("Failed to get information from doi: " + URL);
    }
  }
  return null;
}

function is_valid_docID(docID: DocID) {
  if (
    docID.arxiv != null &&
    docID.doi != null &&
    docID.isbn != null &&
    docID.path != null
  )
    return true;
  else return false;
}

async function getDocID(
  pdf: string,
  papers_dir: string,
  is_book: boolean,
  download_url: string | null
): Promise<DocID> {
  const pdf_fullpath = path.join(papers_dir, pdf);

  // Handle docIDs embedded in filenames.
  const manuallyWrittenDocID = getDocIDManuallyWritten(pdf);
  if (manuallyWrittenDocID != null) {
    return manuallyWrittenDocID;
  }

  // Download link gives you additional information
  if (download_url != null) {
    const docIDFromUrl = getDocIDFromUrl(download_url);
    if (docIDFromUrl != null) {
      return docIDFromUrl;
    }
  }

  // Try to get information using filename as title. Skip if `is_book` because
  // titles of chapters are sometimes confusing such as "Reference".
  if (!is_book) {
    const docIDFromTitle = await getDocIDFromTitle(pdf, papers_dir);
    if (docIDFromTitle != null) {
      return docIDFromTitle;
    }
  }

  // Parse the contents of PDF and try to extract DOI, ISBN or arXiv ID.
  let dataBuffer = fs.readFileSync(pdf_fullpath);
  const texts = await pdfparse(dataBuffer)
    .then((data) => {
      // See https://www.npmjs.com/package/pdf-parse for usage
      return data.text.split(/\r?\n/);
    })
    .catch((e) => {
      logger.warn(e.message);
      return null;
    });

  if (texts == null) {
    logger.warn("Failed to extract text from " + pdf_fullpath);
    return { doi: null, isbn: null, arxiv: null, path: null };
  }
  let id = getDocIDFromTexts(texts);
  if (is_book) {
    id.doi = null;
    id.arxiv = null;
    id.path = null;
  }
  if (is_book || is_valid_docID(id)) {
    return id;
  }

  // The fallback case.
  logger.warn("Cannot decide docID of " + pdf);
  return { doi: null, arxiv: null, path: null, isbn: null };
}

async function getDoiJSON(doi: string): Promise<Object> {
  let { got } = await import("got");

  const URL = "https://api.crossref.org/v1/works/" + doi + "/transform";
  const options = { headers: { Accept: "application/json" } };
  try {
    const data = (await got(URL, options).json()) as Object;
    return data;
  } catch {
    logger.warn("Failed to get information from doi: " + URL);
    return new Object();
  }
}

async function getIsbnJson(isbn: string) {
  const b = await node_isbn
    .resolve(isbn)
    .then(function (book) {
      return book;
    })
    .catch(function (err) {
      logger.warn("Failed to get information from ISBN: " + isbn);
      return null;
    });
  return b;
}

async function getArxivJson(arxiv: string) {
  let { got } = await import("got");

  const URL = "http://export.arxiv.org/api/query?id_list=" + arxiv;
  const options = { headers: { Accept: "application/json" } };
  try {
    const data = (await got(URL, options)).body;
    let jsonData;
    const parser = new xml2js.Parser({
      async: false,
      explicitArray: false,
    });
    parser.parseString(data, (error, json) => {
      jsonData = json;
    });
    if (jsonData.feed.entry == undefined) {
      logger.warn(
        "Failed to get information from arXiv: " +
          URL +
          JSON.stringify(jsonData)
      );
      return new Object();
    } else {
      return jsonData.feed.entry;
    }
  } catch {
    logger.warn("Failed to get information from arXiv: " + URL);
    return new Object();
  }
}

// Return [JSON, ID]
async function getJson(
  docID: DocID,
  path: string
): Promise<[Object, string] | null> {
  let json_r: Object | null = null;
  let db_id: string | null = null;

  if (docID.arxiv != null) {
    let json = await getArxivJson(docID.arxiv);
    if (json != null) {
      json["path"] = path;
      json["id_type"] = "arxiv";
      json_r = json;
      db_id = "arxiv_" + docID.arxiv;
    } else {
      logger.warn(
        "Failed to get information of " +
          JSON.stringify(docID) +
          " using arxiv " +
          path
      );
    }
  }
  if (docID.doi != null && (json_r == null || json_r["title"] == null)) {
    let json = await getDoiJSON(docID.doi);
    if (json != null) {
      json["path"] = path;
      json["id_type"] = "doi";
      json_r = json;
      db_id = "doi_" + docID.doi;
    } else {
      logger.warn(
        "Failed to get information of " +
          JSON.stringify(docID) +
          " using doi " +
          path
      );
    }
  }
  if (docID.isbn != null && (json_r == null || json_r["title"] == null)) {
    let json = await getIsbnJson(docID.isbn);
    if (json != null) {
      json["path"] = path;
      json["id_type"] = "isbn";
      json_r = json;
      db_id = "isbn_" + docID.isbn;
    } else {
      logger.warn(
        "Failed to get information of " +
          JSON.stringify(docID) +
          " using isbn " +
          path
      );
    }
  }
  if (docID.path != null && (json_r == null || json_r["title"] == null)) {
    let json = new Object();
    json["path"] = path;
    json["title"] = docID.path;
    json["id_type"] = "path";
    json_r = json;
    db_id = "path_" + docID.path;
  }

  if (json_r == null || db_id == null) {
    logger.warn(
      "Failed to get information of " +
        JSON.stringify(docID) +
        " path = " +
        path +
        " json_r = " +
        JSON.stringify(json_r) +
        " db_id = " +
        JSON.stringify(db_id)
    );
    return null;
  } else {
    return [json_r, db_id];
  }
}

function isValidJsonEntry(json: Object) {
  return json["title"] != null && json["path"] != null;
}

function genDummyDB(output: string) {
  const n_entry = 500;

  let json_db = new Object();
  for (let i = 0; i < n_entry; i++) {
    const id = "path_" + crypto.randomBytes(20).toString("hex");
    json_db[id] = new Object();
    json_db[id]["title"] = crypto.randomBytes(40).toString("hex");
    json_db[id]["path"] = crypto.randomBytes(40).toString("hex");
    json_db[id]["abstract"] = crypto.randomBytes(280).toString("hex");
    json_db[id]["comments"] = crypto.randomBytes(280).toString("hex");
  }

  fs.writeFileSync(output, JSON.stringify(json_db));
}

async function registerNonBookPDF(
  papers_dir: string,
  pdf: string,
  json_db: any,
  comments: string,
  tags: string[],
  rename_using_title: boolean,
  download_url: string | null
) {
  logger.info(
    "papers_dir = " +
      papers_dir +
      " pdf = " +
      pdf +
      " tags = " +
      tags +
      " comments = " +
      comments
  );
  const docID = await getDocID(pdf, papers_dir, false, download_url);
  logger.info("docID = " + JSON.stringify(docID));
  if (
    docID.arxiv == null &&
    docID.doi == null &&
    docID.isbn == null &&
    docID.path == null
  ) {
    logger.fatal("Cannot get docID of " + pdf);
  }
  const t = await getJson(docID, pdf);

  if (t == null) {
    logger.warn(pdf + " is not valid.");
    return json_db;
  }

  const json = t[0];
  const dbID = t[1];

  json["comments"] = comments;
  json["tags"] = tags;

  if (json_db.hasOwnProperty(dbID)) {
    logger.warn(
      pdf +
        " is duplicated. You can find another file in " +
        json_db[dbID]["path"] +
        "."
    );
    console.warn("mv ", '"' + pdf + '" duplicated');
    return json_db;
  }

  if (isValidJsonEntry(json)) {
    // TODO: Condition of json["id_type"] != "path" is not good
    if (rename_using_title && json["id_type"] != "path") {
      const new_filename = path.join(
        path.dirname(pdf),
        json["title"].replace(/[/\\?%*:|"<>.]/g, "") + " " + path.basename(pdf)
      );
      const old_fileneme = json["path"];
      json["path"] = new_filename;

      if (fs.existsSync(path.join(papers_dir, new_filename))) {
        logger.warn(new_filename + " already exists. Skip registration.");
        return json_db;
      }
      fs.renameSync(
        path.join(papers_dir, old_fileneme),
        path.join(papers_dir, new_filename)
      );
      logger.info("Rename " + old_fileneme + " to " + new_filename);
    }

    json_db[dbID] = json;
    return json_db;
  }
}

async function genDB(
  papers_dir: string,
  book_dirs_str: string,
  db_name: string
) {
  let book_dirs = book_dirs_str == "" ? [] : book_dirs_str.split(",");
  for (let i = 0; i < book_dirs.length; i++) {
    // TODO: OS dependency
    if (book_dirs[i].slice(-1) != "/") {
      book_dirs[i] = book_dirs[i] + "/";
    }
    if (book_dirs[i].startsWith(papers_dir)) {
      book_dirs[i] = book_dirs[i].replace(papers_dir, "");
    }
  }

  if (!fs.existsSync(papers_dir)) {
    logger.warn("papers_dir:", papers_dir + " is not exist.");
    return;
  }
  for (const bd of book_dirs) {
    if (!fs.existsSync(path.join(papers_dir, bd))) {
      logger.warn("bd:", path.join(papers_dir, bd) + " is not exist.");
      return;
    }
  }

  let book_db = new Object();
  let json_db = new Object();
  let exsting_pdfs: string[] = [];
  if (fs.existsSync(path.join(papers_dir, db_name))) {
    json_db = JSON.parse(
      fs.readFileSync(path.join(papers_dir, db_name)).toString()
    );
    for (const id of Object.keys(json_db)) {
      exsting_pdfs.push(json_db[id]["path"]);
    }
  }

  let pdfs = walkPDF(papers_dir);
  pdfs.sort();
  for (const p of pdfs) {
    if (exsting_pdfs.includes(p)) {
      continue;
    }
    if (p.includes(JENDELEY_NO_TRACK)) {
      continue;
    }

    logger.info("Processing " + p);
    let is_book = false;
    for (const bd of book_dirs) {
      if (book_db[bd] == undefined) {
        book_db[bd] = {};
      }
      if (p.startsWith(bd)) {
        is_book = true;
        const docID = await getDocID(p, papers_dir, true, null);
        const t = await getJson(docID, p);
        if (t != null && t[0]["id_type"] == "isbn") {
          const json = t[0];
          book_db[bd][p] = json;
          book_db[bd]["id"] = t[1];
        } else {
          book_db[bd][p] = new Object();
        }
      }
    }

    if (!is_book) {
      json_db = await registerNonBookPDF(
        papers_dir,
        p,
        json_db,
        "",
        [],
        false,
        null
      );
    }
  }

  for (const book_dir of Object.keys(book_db)) {
    let book_info: Object | null = null;
    let book_id: string | null = "";
    for (const path of Object.keys(book_db[book_dir])) {
      if (
        book_db[book_dir][path] != null &&
        book_db[book_dir][path]["id_type"] == "isbn"
      ) {
        book_info = book_db[book_dir][path];
        book_id = book_db[book_dir]["id"];
      }
    }
    if (book_info != null && book_id != null) {
      for (const chapter_path of Object.keys(book_db[book_dir])) {
        const chapter_id = book_id + "_" + path.basename(chapter_path);
        let chapter_info = JSON.parse(JSON.stringify(book_info));
        chapter_info["title"] = path.join(
          chapter_info["title"],
          path.basename(chapter_path, ".pdf")
        );
        chapter_info["id_type"] = "book";
        chapter_info["path"] = chapter_path;
        if (json_db.hasOwnProperty(chapter_id)) {
          logger.warn(chapter_id, " is already registered.");
        }
        if (isValidJsonEntry(chapter_info)) {
          json_db[chapter_id] = chapter_info;
        }
      }
    }
  }

  let registered_pdfs: string[] = [];
  for (const id of Object.keys(json_db)) {
    registered_pdfs.push(json_db[id]["path"]);
  }

  const not_registerd_pdfs = pdfs.filter((x) => !registered_pdfs.includes(x));

  if (not_registerd_pdfs.length > 0) {
    logger.warn(
      not_registerd_pdfs.length +
        " files are not registered. Please edit edit_and_run.sh and run it so that we can find IDs."
    );
    const register_shellscript = "edit_and_run.sh";
    let commands = "";
    for (const nr of not_registerd_pdfs) {
      commands = commands + "mv " + '"' + nr + '"' + ' "' + nr + '"\n';
    }
    fs.writeFileSync(register_shellscript, commands);
  }

  try {
    const db_path = path.join(papers_dir, db_name);
    fs.writeFileSync(db_path, JSON.stringify(json_db));
  } catch (err) {
    logger.warn(err);
  }
}

export {
  genDB,
  getDocID,
  genDummyDB,
  getDocIDFromTexts,
  getJson,
  getDoiJSON,
  getTitleFromPath,
  getDocIDFromTitle,
  registerNonBookPDF,
};
