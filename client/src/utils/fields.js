export const getInputType = (column) => {
  const type = String(column?.dataType || '').toLowerCase();

  if (type === 'date') return 'date';
  if (['datetime', 'timestamp'].includes(type)) return 'datetime-local';
  if (type === 'time') return 'time';
  if (['int', 'tinyint', 'smallint', 'mediumint', 'bigint', 'decimal', 'numeric', 'float', 'double', 'real'].includes(type)) {
    return 'number';
  }

  return 'text';
};

export const getInputStep = (column) => {
  const type = String(column?.dataType || '').toLowerCase();

  if (['decimal', 'numeric', 'float', 'double', 'real'].includes(type)) return 'any';
  if (['datetime', 'timestamp', 'time'].includes(type)) return '1';
  return undefined;
};

export const formatValueForInput = (column, value) => {
  if (value === null || value === undefined) return '';

  const type = String(column?.dataType || '').toLowerCase();
  const text = String(value);

  if (type === 'date') {
    return text.slice(0, 10);
  }

  if (['datetime', 'timestamp'].includes(type)) {
    return text.replace(' ', 'T').slice(0, 19);
  }

  if (type === 'time') {
    return text.slice(0, 8);
  }

  return text;
};

export const buildEditableValues = (schema, row) => {
  const values = {};

  schema.forEach((column) => {
    values[column.name] = formatValueForInput(column, row?.[column.name]);
  });

  return values;
};

