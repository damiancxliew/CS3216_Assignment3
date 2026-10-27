import type { AdventureSpec, CheckIssue, PreparationGroup } from '../index.js'
import { sourceSentenceSpans } from '../reading-support.js'

/** Authoring checks also run after teacher edits, not only at generation time. */
export function preparationIssues(spec: AdventureSpec): CheckIssue[] {
  const issues: CheckIssue[] = []
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message })
  const discoveries = new Map(spec.discoveries.map(d => [d.id, d]))
  const stageOrder = new Map(spec.stages.map((s, i) => [s.id, i]))
  const questionIds = new Set<string>()

  spec.documents.forEach((doc, i) => {
    const check = doc.readingCheck
    if (!check) return
    const path = `documents.${i}.readingCheck`
    const discovery = discoveries.get(check.discoveryId)
    if (!discovery || !('documentId' in discovery.holder) || discovery.holder.documentId !== doc.id)
      add('reading-check', `${path}.discoveryId`, 'The check must establish a discovery held by this document.')
    const sentences = sourceSentenceSpans(doc.body)
    doc.keyPassages.forEach((passage, j) => {
      const touched = sentences.filter(s => s.start < passage.end && s.end > passage.start)
      if (passage.end > doc.body.length || passage.end <= passage.start || touched.length === 0 || touched.length > 2 || touched.length === sentences.length)
        add('reading-check', `documents.${i}.keyPassages.${j}`, 'Checked scroll notes must have a short, collectable passage within the source.')
    })
    const prompts = new Set<string>()
    for (const [q, name] of [...check.variants.map((q, j) => [q, `variants.${j}`] as const), [check.recovery, 'recovery'] as const]) {
      const at = `${path}.${name}`
      if (questionIds.has(q.id)) add('reading-check', `${at}.id`, 'Reading question IDs must be unique.')
      questionIds.add(q.id)
      const optionIds = q.options.map(o => o.id)
      if (new Set(optionIds).size !== optionIds.length || !optionIds.includes(q.correctOptionId))
        add('reading-check', `${at}.correctOptionId`, 'Use distinct option IDs and an answer belonging to this question.')
      if (new Set(q.options.map(o => o.text.trim().toLowerCase())).size !== q.options.length)
        add('reading-check', `${at}.options`, 'Interpretations must be distinct.')
      const prompt = q.prompt.trim().toLowerCase()
      if (prompts.has(prompt)) add('reading-check', `${at}.prompt`, 'Write a different question for each attempt and recovery.')
      prompts.add(prompt)
      q.support.forEach((span, k) => {
        const first = sentences.findIndex(s => s.start === span.start), last = sentences.findIndex(s => s.end === span.end)
        if (first < 0 || last < first || last - first > 1)
          add('reading-check', `${at}.support.${k}`, 'Support must cover one or two complete source sentences at valid offsets.')
        else if (first === 0 && last >= sentences.length - 2 || last === sentences.length - 1 && first <= 1)
          add('reading-check', `${at}.support.${k}`, 'The whole document must not fit within support plus one context sentence.')
      })
    }
    const seen = new Set<string>()
    check.recoveryDiscoveryIds.forEach((id, j) => {
      const other = discoveries.get(id)
      if (seen.has(id) || !other || !('documentId' in other.holder) || other.holder.documentId === doc.id || discovery && (stageOrder.get(other.stageId) ?? Infinity) > (stageOrder.get(discovery.stageId) ?? -1))
        add('reading-check', `${path}.recoveryDiscoveryIds.${j}`, 'Recovery alternatives must be distinct relevant document discoveries available by this stage, outside this scroll.')
      seen.add(id)
    })
  })

  spec.stages.forEach((stage, i) => {
    const prep = stage.preparation
    if (!prep) return
    const path = `stages.${i}.preparation`
    const present = new Set([...Object.keys(stage.placement), ...stage.situations.flatMap(s => Object.keys(s.placement ?? {}))])
    const groups = (values: PreparationGroup[], at: string) => {
      const used = new Set<string>()
      values.forEach((group, j) => {
        if (group.minMet > group.discoveryIds.length) add('preparation', `${at}.${j}.minMet`, 'The required count exceeds the available alternatives.')
        group.discoveryIds.forEach((id, k) => {
          const d = discoveries.get(id)
          if (used.has(id)) add('preparation', `${at}.${j}.discoveryIds.${k}`, 'One discovery cannot count twice towards the same preparation target.')
          if (!d || (stageOrder.get(d.stageId) ?? Infinity) > i) add('preparation', `${at}.${j}.discoveryIds.${k}`, 'Preparation must name a discovery available by this stage.')
          used.add(id)
        })
      })
    }
    for (const [id, requirements] of Object.entries(prep.characters)) {
      if (!present.has(id)) add('preparation', `${path}.characters.${id}`, 'Only characters present in this stage can have preparation requirements.')
      groups(requirements, `${path}.characters.${id}`)
    }
    for (const id of present) if (!Object.hasOwn(prep.characters, id)) add('preparation', `${path}.characters`, `Declare preparation for '${id}', using an empty list only when no preparation is intended.`)
    if (!prep.decision.some(group => group.discoveryIds.length > group.minMet)) add('preparation', `${path}.decision`, 'Provide at least one spare alternative for decision preparation.')
    const essentialIds = new Set<string>()
    prep.essentialCharacters.forEach((character, j) => {
      const at = `${path}.essentialCharacters.${j}`
      if (!present.has(character.characterId) || essentialIds.has(character.characterId)) add('preparation', `${at}.characterId`, 'Essential characters must be distinct and present in this stage.')
      essentialIds.add(character.characterId)
      if (!prep.characters[character.characterId]?.length) add('preparation', `${at}.characterId`, 'Author relevant preparation for each essential character.')
      if (new Set(character.discoveryIds).size !== character.discoveryIds.length) add('preparation', `${at}.discoveryIds`, 'Qualifying facts must be distinct.')
      character.discoveryIds.forEach((id, k) => {
        const d = discoveries.get(id)
        if (!d || d.stageId !== stage.id || !('characterId' in d.holder) || d.holder.characterId !== character.characterId)
          add('preparation', `${at}.discoveryIds.${k}`, 'Essential conversation facts must belong to that character in this stage.')
      })
    })
    const decider = spec.definingMoments.find(moment => moment.id === stage.definingMomentId)?.deciderId
    if (decider !== undefined && !essentialIds.has(decider)) add('preparation', `${path}.essentialCharacters`, 'The person making the stage decision must be an essential conversation.')
    groups(prep.decision, `${path}.decision`)
    const documents = new Set([
      ...Object.keys(stage.documentPlacement), ...stage.situations.flatMap(s => Object.keys(s.documentPlacement ?? {})),
      ...spec.storyEvents.filter(event => event.stageId === stage.id && event.effect === 'deliverDocument').map(event => 'documentId' in event ? event.documentId : ''),
      ...spec.triggers.filter(trigger => present.has(trigger.characterId)).flatMap(trigger => trigger.handsOver ?? []),
    ])
    for (const id of documents) {
      const index = spec.documents.findIndex(d => d.id === id)
      if (index >= 0 && !spec.documents[index]!.readingCheck) add('reading-check', `documents.${index}.readingCheck`, 'Every scroll in a prepared stage needs a reading check.')
    }
  })
  return issues
}
