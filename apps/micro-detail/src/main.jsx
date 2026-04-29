import React from "react";
import { createRoot } from "react-dom/client";
import DetailPanel from "./DetailPanel.jsx";

createRoot(document.getElementById("root")).render(<DetailPanel item={{ title: "Preview item" }} />);
