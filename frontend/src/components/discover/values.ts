import type { CatalogValues, FilterField } from '../../api'

/** A field's current value: the URL's when set, else the catalogue's default. */
export function valueOf(field: FilterField, values: CatalogValues): string {
  return values[field.key] ?? field.default
}

/** The values with one field changed; a default value is dropped, so the URL
 *  only ever carries what the user actually chose. */
export function withValue(values: CatalogValues, field: FilterField, value: string): CatalogValues {
  const next = { ...values }
  if (value === field.default) delete next[field.key]
  else next[field.key] = value
  return next
}
