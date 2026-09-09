"use client";

import { useState } from "react";
import { CalendarClock, History } from "lucide-react";
import StaffDailyTimesheet from "./StaffDailyTimesheet";
import StaffTimesheetsWorkspace from "./StaffTimesheetsWorkspace";

export default function StaffTimesheetsHub() {
  const [tab, setTab] = useState("entry"); // "entry" | "history"

  return (
    <div>
      <nav
        aria-label="Timesheets sections"
        style={{ display: "flex", gap: 8, padding: "16px 20px 0" }}
      >
        <button
          type="button"
          onClick={() => setTab("entry")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 16px", borderRadius: 8, border: "1px solid #cdd8c6",
            background: tab === "entry" ? "#1f5a34" : "#fff",
            color: tab === "entry" ? "#fff" : "#3a4740",
            fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <CalendarClock size={14} /> Daily Entry
        </button>
        <button
          type="button"
          onClick={() => setTab("history")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 16px", borderRadius: 8, border: "1px solid #cdd8c6",
            background: tab === "history" ? "#1f5a34" : "#fff",
            color: tab === "history" ? "#fff" : "#3a4740",
            fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <History size={14} /> History &amp; Export
        </button>
      </nav>
      {tab === "entry" ? <StaffDailyTimesheet embedded /> : <StaffTimesheetsWorkspace />}
    </div>
  );
}
