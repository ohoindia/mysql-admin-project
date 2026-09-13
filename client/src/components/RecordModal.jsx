import { getInputType, getInputStep } from "../utils/fields";

export default function RecordModal({ browser, superUser }) {
  const {
    table,
    schema,
    adding,
    setAdding,
    newRow,
    setNewRow,
    insertRow,
    editing,
    setEditing,
    primaryKey,
    save,
  } = browser;
  const renderField = (column, value, onChange, disabled = false) => {
    const type = getInputType(column);
    const step = getInputStep(column);

    return (
      <input
        type={type}
        step={step}
        disabled={disabled}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={column.columnType || column.dataType}
      />
    );
  };

  return (
    <>
      {adding && (
        <div className="modal">
          <div className="card">
            <div className="modal-header">
              <div>
                <h3>Add New Row - {table}</h3>
                <span>Date/time fields use native date/time pickers.</span>
              </div>
              <button className="modal-close" onClick={() => setAdding(false)}>
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="edit-grid">
                {schema
                  .filter(
                    (column) =>
                      !String(column.extra || "")
                        .toLowerCase()
                        .includes("auto_increment"),
                  )
                  .map((column) => (
                    <label key={column.name}>
                      <span>
                        {column.name}
                        {column.isNullable === "NO" &&
                          column.columnDefault == null && (
                            <small className="required"> *</small>
                          )}
                        <small className="field-type">
                          {" "}
                          {column.columnType || column.dataType}
                        </small>
                      </span>

                      {renderField(column, newRow[column.name] ?? "", (value) =>
                        setNewRow({ ...newRow, [column.name]: value }),
                      )}
                    </label>
                  ))}
              </div>
            </div>

            <div className="modal-buttons">
              <button className="primary" onClick={insertRow}>
                Insert Row
              </button>
              <button onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {superUser && editing && (
        <div className="modal">
          <div className="card">
            <div className="modal-header">
              <div>
                <h3>Edit {table}</h3>
                <span>
                  {primaryKey}: {String(editing.original[primaryKey] ?? "")}
                </span>
              </div>
              <button className="modal-close" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="edit-grid">
                {schema.map((column) => (
                  <label key={column.name}>
                    <span>
                      {column.name}
                      {column.name === primaryKey && (
                        <small> (Primary Key)</small>
                      )}
                      <small className="field-type">
                        {" "}
                        {column.columnType || column.dataType}
                      </small>
                    </span>

                    {renderField(
                      column,
                      editing.values[column.name] ?? "",
                      (value) =>
                        setEditing({
                          ...editing,
                          values: { ...editing.values, [column.name]: value },
                        }),
                      column.name === primaryKey,
                    )}
                  </label>
                ))}
              </div>
            </div>

            <div className="modal-buttons">
              <button className="primary" onClick={save}>
                Save Changes
              </button>
              <button onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
