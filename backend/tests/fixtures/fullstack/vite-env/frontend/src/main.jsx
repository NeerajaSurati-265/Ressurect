import React from "react";
import { createRoot } from "react-dom/client";
const API = import.meta.env.VITE_API_URL;
function App() {
  const [notes, setNotes] = React.useState([]);
  React.useEffect(() => { fetch(API + "/notes").then(r => r.json()).then(setNotes); }, []);
  return <ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>;
}
createRoot(document.getElementById("root")).render(<App />);
