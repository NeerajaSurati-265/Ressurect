import React from "react";
import { createRoot } from "react-dom/client";
const DEV = "http://localhost:3000"; // an unrelated origin that must survive
function App() {
  const [notes, setNotes] = React.useState([]);
  React.useEffect(() => { fetch("http://localhost:8000/notes").then(r => r.json()).then(setNotes); }, []);
  return <ul title={DEV}>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>;
}
createRoot(document.getElementById("root")).render(<App />);
