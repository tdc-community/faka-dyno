import { useEffect, useState } from "react";

interface InlineEditableProps {
  value: string;
  onCommit: (value: string) => void;
  className?: string;
  multiline?: boolean;
  maxLength?: number;
}

interface InlineEditableSelectProps {
  value: string;
  options: string[];
  onCommit: (value: string) => void;
  className?: string;
}

export function InlineEditable({
  value,
  onCommit,
  className = "",
  multiline = false,
  maxLength,
}: InlineEditableProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [value, editing]);

  const finish = () => {
    setEditing(false);
    if (draft !== value) {
      onCommit(draft);
    }
  };

  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (editing) {
    if (multiline) {
      return (
        <textarea
          className={`inline-editable-input inline-editable-textarea ${className}`.trim()}
          value={draft}
          maxLength={maxLength}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finish}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              finish();
            }
          }}
        />
      );
    }

    return (
      <input
        type="text"
        className={`inline-editable-input ${className}`.trim()}
        value={draft}
        maxLength={maxLength}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={`inline-editable-display ${className}`.trim()}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {value || "-"}
    </button>
  );
}

export function InlineEditableSelect({
  value,
  options,
  onCommit,
  className = "",
}: InlineEditableSelectProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <select
        className={`inline-editable-input inline-editable-select ${className}`.trim()}
        value={value}
        autoFocus
        onChange={(event) => {
          onCommit(event.target.value);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
          }
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <button
      type="button"
      className={`inline-editable-display ${className}`.trim()}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {value || "-"}
    </button>
  );
}