import { AdventureSpec as adventureSpecSchema } from '@adventure/spec-v3'
import { z } from 'zod'

import { unwrap } from '@/lib/v3/edit/form'

export type Path = (string | number)[]

export type EditableItem = {
  key: string
  path: Path
  label: string
  preview: string
}

export type TextField = {
  path: Path
  label: string
  text: string
  locked?: string
}

const protectedFields = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'id',
  'schemaVersion',
  'citations',
  'sourceLabel',
  'real',
  'authoring',
  'sources',
  'sourceId',
  'documentId',
  'characterId',
  'stageId',
  'endingId',
  'correctOptionId',
  'discoveryId',
  'discoveryIds',
  'recoveryDiscoveryIds',
  'support',
  'minMet',
])

const collections = [
  ['stages', 'Stage'],
  ['characters', 'Character'],
  ['documents', 'Document'],
  ['discoveries', 'Discovery'],
  ['definingMoments', 'Decision'],
  ['endings', 'Ending'],
  ['teacherQuestions', 'Discussion question'],
] as const

const fieldNames: Record<string, string> = {
  definingMoments: 'Decision',
  teacherQuestions: 'Discussion question',
  whatHappened: 'What happened',
  openingNarration: 'Opening narration',
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

export function isProtectedPath(path: Path): boolean {
  return path.some((part) => protectedFields.has(String(part)))
}

export function pathLabel(path: Path): string {
  const labels: string[] = []
  for (let index = 0; index < path.length; index += 1) {
    const part = path[index]
    if (typeof part === 'number') {
      labels.push(String(part + 1))
      continue
    }
    const label =
      fieldNames[part] ??
      part
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/^./, (char) => char.toUpperCase())
    const next = path[index + 1]
    if (typeof next === 'number') {
      const singular = label.endsWith('ies')
        ? `${label.slice(0, -3)}y`
        : label.endsWith('s')
          ? label.slice(0, -1)
          : label
      labels.push(`${singular} ${next + 1}`)
      index += 1
    } else {
      labels.push(label)
    }
  }
  return labels.join(' · ')
}

function itemLabel(value: unknown, kind: string, index?: number): string {
  if (isRecord(value)) {
    if (typeof value.name === 'string' && value.name.trim()) return value.name
    if (typeof value.title === 'string' && value.title.trim()) return value.title
  }
  return index === undefined ? kind : `${kind} ${index + 1}`
}

function unionOptions(schema: z.ZodType): z.ZodType[] {
  const def = schema._zod.def as { options?: unknown }
  const options =
    def.options ?? (schema as unknown as { options?: unknown }).options
  if (Array.isArray(options))
    return options.filter((option): option is z.ZodType =>
      Boolean(option && typeof option === 'object' && '_zod' in option),
    )
  if (options instanceof Map)
    return [...options.values()].filter((option): option is z.ZodType =>
      Boolean(option && typeof option === 'object' && '_zod' in option),
    )
  if (isRecord(options))
    return Object.values(options).filter((option): option is z.ZodType =>
      Boolean(option && typeof option === 'object' && '_zod' in option),
    )
  return []
}

function unionOption(schema: z.ZodType, value: unknown): z.ZodType | undefined {
  const options = unionOptions(schema)
  const validOption = options.find((option) => option.safeParse(value).success)
  if (validOption) return validOption
  if (!isRecord(value)) return options[0]
  return (
    options.find((option) => {
      const unwrapped = unwrap(option)
      if (unwrapped._zod.def.type !== 'object') return false
      const shape = (unwrapped as z.ZodObject).shape
      return (
        Object.keys(value).every((key) => key in shape) &&
        Object.entries(shape).every(
          ([key, field]) =>
            (field as z.ZodType).isOptional() || key in value,
        )
      )
    }) ?? options[0]
  )
}

function schemaAtPath(spec: unknown, path: Path): z.ZodType | undefined {
  let schema = adventureSpecSchema as z.ZodType
  let value = spec
  let index = 0
  while (index < path.length) {
    const unwrapped = unwrap(schema)
    const part = path[index]!
    const kind = unwrapped._zod.def.type
    if (kind === 'union') {
      const option = unionOption(unwrapped, value)
      if (!option || option === schema) return undefined
      schema = option
      continue
    }
    if (kind === 'object' && typeof part === 'string') {
      const child = (unwrapped as z.ZodObject).shape[part] as
        | z.ZodType
        | undefined
      if (!child) return undefined
      schema = child
      value = isRecord(value) ? value[part] : undefined
      index += 1
      continue
    }
    if (kind === 'array' && typeof part === 'number') {
      schema = (unwrapped as z.ZodArray).element as z.ZodType
      value = Array.isArray(value) ? value[part] : undefined
      index += 1
      continue
    }
    if (kind === 'record' && typeof part === 'string') {
      schema = (unwrapped as z.ZodRecord).valueType as z.ZodType
      value = isRecord(value) ? value[part] : undefined
      index += 1
      continue
    }
    return undefined
  }
  return unwrap(schema)
}

function stringLeaves(
  spec: unknown,
  value: unknown,
  path: Path,
  result: { path: Path; text: string }[],
) {
  if (typeof value === 'string') {
    const schema = schemaAtPath(spec, path)
    const kind = schema?._zod.def.type
    if (!isProtectedPath(path) && kind !== 'enum' && kind !== 'literal')
      result.push({ path, text: value })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      stringLeaves(spec, item, [...path, index], result),
    )
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) {
    stringLeaves(spec, child, [...path, key], result)
  }
}

function preview(spec: unknown, value: unknown, path: Path): string {
  const leaves: { path: Path; text: string }[] = []
  stringLeaves(spec, value, path, leaves)
  return leaves.map(({ text }) => text.trim()).filter(Boolean).join(' ').slice(0, 300)
}

export function editableItems(spec: unknown): EditableItem[] {
  if (!isRecord(spec)) return []
  const items: EditableItem[] = []
  if (typeof spec.title === 'string') {
    const path: Path = ['title']
    items.push({
      key: path.join('.'),
      path,
      label: 'Adventure title',
      preview: preview(spec, spec.title, path),
    })
  }
  if (spec.reveal !== undefined && spec.reveal !== null) {
    const path: Path = ['reveal']
    items.push({
      key: path.join('.'),
      path,
      label: itemLabel(spec.reveal, 'Reveal'),
      preview: preview(spec, spec.reveal, path),
    })
  }
  for (const [collection, kind] of collections) {
    const values = spec[collection]
    if (!Array.isArray(values)) continue
    values.forEach((value, index) => {
      const path: Path = [collection, index]
      items.push({
        key: path.join('.'),
        path,
        label: itemLabel(value, kind, index),
        preview: preview(spec, value, path),
      })
    })
  }
  return items
}

function atPath(value: unknown, path: Path): unknown {
  let current = value
  for (const part of path) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, part))
      return undefined
    current = (current as Record<string | number, unknown>)[part]
  }
  return current
}

function isPrefix(prefix: Path, path: Path): boolean {
  return prefix.length <= path.length &&
    prefix.every((part, index) => String(part) === String(path[index]))
}

const textFieldCache = new WeakMap<object, Map<string, TextField[]>>()

export function textFields(spec: unknown, itemPath: Path): TextField[] {
  if (!spec || typeof spec !== 'object') return collectTextFields(spec, itemPath)
  let bySpec = textFieldCache.get(spec)
  if (!bySpec) textFieldCache.set(spec, (bySpec = new Map()))
  const key = itemPath.join('.')
  let fields = bySpec.get(key)
  if (!fields) bySpec.set(key, (fields = collectTextFields(spec, itemPath)))
  return fields
}

function collectTextFields(spec: unknown, itemPath: Path): TextField[] {
  const item = atPath(spec, itemPath)
  const leaves: { path: Path; text: string }[] = []
  stringLeaves(spec, item, itemPath, leaves)
  const itemInfo = editableItems(spec).find(({ path }) => path.join('.') === itemPath.join('.'))
  if (!itemInfo) return []
  const isRealDocument = itemPath[0] === 'documents' &&
    isRecord(item) && item.real === true
  return leaves
    .filter(({ path }) => !isProtectedPath(path))
    .map(({ path, text }) => {
      const relative = path.slice(itemPath.length)
      const label = relative.length
        ? `${itemInfo.label} · ${pathLabel(relative)}`
        : itemInfo.label
      const locked = isRealDocument && path.at(-1) === 'body'
        ? "Quoted from your source — chat can't rewrite it."
        : undefined
      return { path, label, text, ...(locked ? { locked } : {}) }
    })
}

export function owningItemPath(spec: unknown, path: Path): Path | null {
  return editableItems(spec)
    .filter((item) => isPrefix(item.path, path))
    .sort((a, b) => b.path.length - a.path.length)[0]?.path ?? null
}
