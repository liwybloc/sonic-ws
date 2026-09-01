package sonicws

import (
	"errors"
	"fmt"
	"math"
)

func (p *Packet) prepare(values []any, connection uint64) ([]any, error) {
	if p.object {
		if len(p.schema) != 0 && len(values) == 1 {
			if record, ok := values[0].(map[string]any); ok {
				return recordValues(record, p.schema)
			}
		}
		if p.autoFlatten && len(p.schema) != 0 {
			if len(values) != 1 {
				return nil, errors.New("autoTranspose expects one record slice")
			}
			rows, ok := values[0].([]any)
			if !ok {
				return nil, errors.New("autoTranspose expects one record slice")
			}
			columns := make([]any, len(p.schema))
			for column := range columns {
				columns[column] = make([]any, len(rows))
			}
			for row, value := range rows {
				record, ok := value.(map[string]any)
				if !ok {
					return nil, errors.New("autoTranspose expects records")
				}
				fields, err := recordValues(record, p.schema)
				if err != nil {
					return nil, err
				}
				for column := range fields {
					columns[column].([]any)[row] = fields[column]
				}
			}
			return columns, nil
		}
		return values, nil
	}
	if p.autoFlatten {
		if len(values) != 1 || len(p.schema) == 0 {
			return nil, errors.New("autoFlatten expects one record slice")
		}
		rows, ok := values[0].([]any)
		if !ok {
			return nil, errors.New("autoFlatten expects one record slice")
		}
		flat := make([]any, 0, len(rows)*len(p.schema))
		for _, value := range rows {
			record, ok := value.(map[string]any)
			if !ok {
				return nil, errors.New("autoFlatten expects records")
			}
			fields, err := recordValues(record, p.schema)
			if err != nil {
				return nil, err
			}
			flat = append(flat, fields...)
		}
		values = flat
	} else if len(p.schema) != 0 && len(values) == 1 {
		if record, ok := values[0].(map[string]any); ok {
			var err error
			values, err = recordValues(record, p.schema)
			if err != nil {
				return nil, err
			}
		}
	}
	return p.transformNumbers(values, connection, true)
}

func (p *Packet) finish(values []any) ([]any, error) {
	if !p.object {
		var err error
		values, err = p.transformNumbers(values, 0, false)
		if err != nil {
			return nil, err
		}
	}
	if len(p.schema) == 0 {
		return values, nil
	}
	if p.autoFlatten {
		if p.object {
			columns := make([][]any, len(values))
			rows := -1
			for n, value := range values {
				column, ok := value.([]any)
				if !ok || (rows >= 0 && len(column) != rows) {
					return nil, errors.New("autoTranspose columns do not match")
				}
				rows = len(column)
				columns[n] = column
			}
			out := make([]any, max(rows, 0))
			for row := range out {
				record := make(map[string]any, len(p.schema))
				for column, name := range p.schema {
					record[name] = columns[column][row]
				}
				out[row] = record
			}
			return []any{out}, nil
		}
		if len(values)%len(p.schema) != 0 {
			return nil, errors.New("flat values do not match schema")
		}
		out := make([]any, len(values)/len(p.schema))
		for row := range out {
			record := make(map[string]any, len(p.schema))
			for column, name := range p.schema {
				record[name] = values[row*len(p.schema)+column]
			}
			out[row] = record
		}
		return []any{out}, nil
	}
	if len(values) != len(p.schema) {
		return nil, errors.New("values do not match schema")
	}
	record := make(map[string]any, len(p.schema))
	for n, name := range p.schema {
		record[name] = values[n]
	}
	return []any{record}, nil
}

func (p *Packet) transformNumbers(values []any, connection uint64, sending bool) ([]any, error) {
	if p.quantized == nil && p.valueMin == nil && p.valueMax == nil {
		return values, nil
	}
	out := make([]any, len(values))
	var residuals []float64
	if sending && p.quantized != nil && !p.quantized.DisableErrorTracking {
		p.quantMu.Lock()
		defer p.quantMu.Unlock()
		residuals = p.residual[connection]
		if len(residuals) != len(values) {
			residuals = make([]float64, len(values))
		}
	}
	for n, value := range values {
		number, ok := number(value)
		if !ok || math.IsNaN(number) || math.IsInf(number, 0) {
			return nil, errors.New("numeric metadata requires finite numbers")
		}
		logical := number
		if !sending && p.quantized != nil {
			logical /= p.quantized.Scale
		}
		if p.valueMin != nil && logical < *p.valueMin || p.valueMax != nil && logical > *p.valueMax {
			return nil, errors.New("number outside logical range")
		}
		if sending && p.quantized != nil {
			var residual float64
			if !p.quantized.DisableErrorTracking {
				residual = residuals[n]
			}
			adjusted := logical*p.quantized.Scale + residual
			if math.IsNaN(adjusted) || math.IsInf(adjusted, 0) || adjusted < math.MinInt64 || adjusted > math.MaxInt64 {
				return nil, errors.New("quantized number exceeds int64")
			}
			wire := math.Floor(adjusted + 0.5)
			if !p.quantized.DisableErrorTracking {
				residuals[n] = adjusted - wire
			}
			out[n] = int64(wire)
		} else if !sending && p.quantized != nil {
			out[n] = logical
		} else {
			out[n] = value
		}
	}
	if sending && p.quantized != nil && !p.quantized.DisableErrorTracking {
		p.residual[connection] = residuals
	}
	return out, nil
}

func (p *Packet) residualState(connection uint64) ([]float64, bool) {
	if p.quantized == nil || p.quantized.DisableErrorTracking {
		return nil, false
	}
	p.quantMu.Lock()
	defer p.quantMu.Unlock()
	value, ok := p.residual[connection]
	return append([]float64(nil), value...), ok
}

func (p *Packet) restoreResidual(connection uint64, value []float64, existed bool) {
	if p.quantized == nil || p.quantized.DisableErrorTracking {
		return
	}
	p.quantMu.Lock()
	defer p.quantMu.Unlock()
	if existed {
		p.residual[connection] = append([]float64(nil), value...)
	} else {
		delete(p.residual, connection)
	}
}

func (p *Packet) forget(connection uint64) {
	p.quantMu.Lock()
	delete(p.residual, connection)
	p.quantMu.Unlock()
}

func recordValues(record map[string]any, schema []string) ([]any, error) {
	if len(record) != len(schema) {
		return nil, errors.New("record fields do not match schema")
	}
	out := make([]any, len(schema))
	for n, name := range schema {
		value, ok := record[name]
		if !ok {
			return nil, fmt.Errorf("record is missing %q", name)
		}
		out[n] = value
	}
	return out, nil
}

func number(value any) (float64, bool) {
	switch value := value.(type) {
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	case uint:
		return float64(value), true
	case uint64:
		return float64(value), true
	case float32:
		return float64(value), true
	case float64:
		return value, true
	default:
		return 0, false
	}
}
