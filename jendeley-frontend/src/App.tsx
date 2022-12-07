import React, { useMemo } from "react";
import Chip from "@mui/material/Chip";
import ReactDOM from "react-dom/client";
import base_64 from "base-64";
import "./App.css";
import { Entry, DB } from "./schema";
import MaterialReactTable, {
  MaterialReactTableProps,
  MRT_ColumnDef,
} from "material-react-table";
import sanitizeHTML from "sanitize-html";
import {
  red,
  pink,
  purple,
  deepPurple,
  indigo,
  blue,
  lightBlue,
  cyan,
  teal,
  green,
  lightGreen,
  lime,
  yellow,
  amber,
  orange,
  deepOrange,
  brown,
  grey,
  blueGrey,
} from "@mui/material/colors";

function hashString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    const cc = s.charCodeAt(i);
    h = (h * 23249425 + cc) % 24862048;
  }
  return h;
}

function getAuthorChipColor(author: string) {
  const colorList = [
    { color: "white", bgcolor: red[900] },
    { color: "white", bgcolor: pink[900] },
    { color: "white", bgcolor: purple[900] },
    { color: "white", bgcolor: deepPurple[900] },
    { color: "white", bgcolor: indigo[900] },
    { color: "white", bgcolor: blue[900] },
    { color: "white", bgcolor: lightBlue[900] },
    { color: "white", bgcolor: cyan[900] },
    { color: "white", bgcolor: teal[900] },
    { color: "white", bgcolor: green[900] },
    { color: "white", bgcolor: lightGreen[900] },
    { color: "white", bgcolor: lime[900] },
    { color: "white", bgcolor: yellow[900] },
    { color: "white", bgcolor: amber[900] },
    { color: "white", bgcolor: orange[900] },
    { color: "white", bgcolor: deepOrange[900] },
    { color: "white", bgcolor: brown[900] },
    { color: "white", bgcolor: grey[900] },
    { color: "white", bgcolor: blueGrey[900] },
  ];
  return colorList[hashString(author) % colorList.length];
}

function authorChips(authors: string[]) {
  // TODO padding or margine
  return (
    <div>
      {authors.map((a) => (
        <Chip
          label={`${a}`}
          size="small"
          sx={{
            color: getAuthorChipColor(a).color,
            bgcolor: getAuthorChipColor(a).bgcolor,
          }}
        />
      ))}
    </div>
  );
}

function tagChips(tags: string[]) {
  // TODO padding or margine
  return (
    <div>
      {tags.map((a) => (
        <Chip label={`${a}`} size="small" />
      ))}
    </div>
  );
}

function abstractHTML(abstract: string) {
  const __html = sanitizeHTML(abstract.replaceAll("<jats:", "<"));
  return <div dangerouslySetInnerHTML={{ __html }}></div>;
}

function App() {
  const [tableData, setTableData] = React.useState<DB>([]);

  React.useEffect(() => {
    console.log("Fetching from DB");
    fetch("http://localhost:5000/api/get_db")
      .then((response) => response.json())
      .then((json) => setTableData(() => json));
  }, []);

  const columns = useMemo<MRT_ColumnDef<Entry>[]>(
    () => [
      {
        accessorKey: "id",
        header: "id",
      },
      {
        accessorKey: "title",
        Cell: ({ cell, row }) => (
          <a
            href={`${
              "http://localhost:5000/api/get_pdf/?file=" +
              base_64.encode(escape(row.original.path))
            }`}
          >{`${cell.getValue()}`}</a>
        ),
        header: "title",
        filterFn: "includesString",
      },
      {
        accessorKey: "path",
        header: "path",
        filterFn: "includesString",
      },
      {
        accessorKey: "authors",
        Cell: ({ cell }) => authorChips(cell.getValue<string[]>()),
        header: "authors",
        filterFn: "includesString",
      },
      {
        accessorKey: "tags",
        Cell: ({ cell }) => tagChips(cell.getValue<string[]>()),
        header: "tags",
        filterFn: "includesString",
      },
      {
        accessorKey: "comments",
        header: "comments",
        filterFn: "includesString",
      },
      {
        accessorKey: "year",
        header: "year",
        filterFn: "betweenInclusive",
      },
      {
        accessorKey: "publisher",
        header: "publisher",
        filterFn: "includesString",
      },
      {
        accessorKey: "abstract",
        Cell: ({ cell }) => abstractHTML(cell.getValue<string>()),
        header: "abstract",
        filterFn: "includesString",
      },
    ],
    []
  );

  const handleSaveRow: MaterialReactTableProps<Entry>["onEditingRowSave"] =
    async ({ exitEditingMode, row, values }) => {
      // TODO: Ban editing fields other than "tags" and "comments".
      const edittedTags = values.tags.split(/[\s,]+/);
      const edittedComments = values.comments;
      tableData[row.index]["tags"] = edittedTags;
      tableData[row.index]["comments"] = edittedComments;

      const e: Entry = {
        abstract: "",
        authors: [],
        id: values.id,
        title: "",
        path: "",
        tags: edittedTags,
        comments: edittedComments,
        year: 0,
        publisher: "",
      };
      const response = await fetch("http://localhost:5000/api/update_entry", {
        method: "PUT",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,PUT,POST,DELETE",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(e),
      });
      console.log("response of update_entry:", response);
      //send/receive api updates here
      setTableData([...tableData]);
      exitEditingMode(); //required to exit editing mode
    };

  return (
    <MaterialReactTable
      columns={columns}
      data={tableData}
      filterFns={{
        titleFilterFn: (row, id, filterValue) =>
          row.original.title.includes(filterValue),
      }}
      enablePagination={true}
      initialState={{
        showColumnFilters: true,
        sorting: [{ id: "year", desc: true }],
        // showGlobalFilter: true,
        columnVisibility: { id: false, path: false },
        pagination: { pageSize: 20, pageIndex: 0 },
        density: "compact",
      }}
      positionGlobalFilter="left"
      enableStickyHeader
      globalFilterFn="titleFilterFn"
      enableColumnResizing
      columnResizeMode="onEnd"
      editingMode="modal" //default
      enableEditing
      onEditingRowSave={handleSaveRow}
    />
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Failed to find the root element");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

export default App;
