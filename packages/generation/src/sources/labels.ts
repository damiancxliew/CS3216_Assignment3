export function sourceLabel(input: {
  origin: 'teacher' | 'outside' | 'invented'
  title?: string
  masthead?: string
  date?: string
}): string {
  const title = input.title?.trim() ?? ''
  const masthead = input.masthead?.trim() ?? ''
  const date = input.date?.trim() ?? ''

  if (masthead && date) return `${masthead}, ${date}`
  if (title) return title
  if (input.origin === 'teacher') return 'from the teacher'
  if (input.origin === 'outside') return 'from an outside source'
  return 'invented'
}
