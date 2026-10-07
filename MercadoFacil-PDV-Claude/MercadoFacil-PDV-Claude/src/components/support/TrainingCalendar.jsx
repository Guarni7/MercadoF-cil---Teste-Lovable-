import React, { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export default function TrainingCalendar({ selectedDate, onSelect }) {
  const [view, setView] = useState(() => {
    const d = selectedDate ? new Date(selectedDate) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const year = view.getFullYear();
  const month = view.getMonth();
  const monthLabel = `${view.toLocaleDateString("pt-BR", { month: "long" })} ${year}`;
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const todayMid = new Date();
  todayMid.setHours(0, 0, 0, 0);
  const selected = selectedDate ? new Date(selectedDate) : null;

  const isDisabled = (d) => {
    const day = d.getDay();
    const weekend = day === 0 || day === 6;
    const past = new Date(d.getFullYear(), d.getMonth(), d.getDate()) < todayMid;
    return weekend || past;
  };

  const isSame = (a, b) => a && b && a.toDateString() === b.toDateString();

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setView(new Date(year, month - 1, 1))}
          className="p-1 rounded-md hover:bg-muted"
        >
          <ChevronLeft className="w-4 h-4" style={{ color: "#006769" }} />
        </button>
        <span className="text-sm font-semibold capitalize" style={{ color: "#1A201C" }}>
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => setView(new Date(year, month + 1, 1))}
          className="p-1 rounded-md hover:bg-muted"
        >
          <ChevronRight className="w-4 h-4" style={{ color: "#006769" }} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs mb-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1 font-medium" style={{ color: "#6E7A75" }}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const disabled = isDisabled(d);
          const sel = isSame(d, selected);
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(d.toISOString())}
              className={`h-9 rounded-md text-sm transition-colors ${
                sel
                  ? "text-white font-bold"
                  : disabled
                  ? "opacity-30 cursor-not-allowed"
                  : "hover:bg-muted"
              }`}
              style={sel ? { background: "#006769" } : {}}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}