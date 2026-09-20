/**
 * D7 — the fixed eval set. Each case is a real document plus the teacher brief
 * a teacher would plausibly type. Adding a document = adding an entry here.
 */
import type { TeacherInputRaw } from '../src/planner/schema'

export interface EvalCase {
  id: string
  /** Paths relative to `fixtures/`; give an explicit id when a fixture spec cites one. */
  files: Array<string | { path: string; id: string }>
  teacher: TeacherInputRaw
}

const LOWER_SECONDARY = { band: 'lower-secondary', ageMin: 13, ageMax: 14 } as const
const UPPER_SECONDARY = { band: 'upper-secondary', ageMin: 15, ageMax: 16 } as const

export const CORPUS: EvalCase[] = [
  {
    id: 'singapore-1819',
    files: [{ path: 'sources/singapore-1819-handout.txt', id: 'handout' }],
    teacher: {
      title: null,
      setting: 'Singapore and the Johor Sultanate, 1819',
      learningObjectives: [
        'Explain why the East India Company wanted a port at the southern end of the Straits of Malacca',
        'Describe the disputed Johor succession and why Raffles recognised Tengku Hussein',
        'Evaluate the risks each stakeholder took in signing the 1819 agreements',
      ],
      studentRole: 'Junior interpreter attached to Raffles\' expedition',
      readingLevel: LOWER_SECONDARY,
      stageCount: 3,
    },
  },
  {
    id: 'mason-1787',
    files: ['eval-corpus/mason-objections-1787.pdf'],
    teacher: {
      title: null,
      setting: 'Philadelphia and Virginia, autumn 1787, after the Constitutional Convention',
      learningObjectives: [
        'Explain George Mason\'s main objections to the proposed Constitution',
        'Describe why some framers wanted a Bill of Rights and others thought it unnecessary',
        'Evaluate whether Mason was right to refuse to sign',
      ],
      studentRole: 'Clerk to the Virginia delegation carrying messages between delegates',
      readingLevel: UPPER_SECONDARY,
      stageCount: 3,
    },
  },
  {
    id: 'spotted-tail-1877',
    files: ['eval-corpus/spotted-tail-agency-1877.pdf'],
    teacher: {
      title: null,
      setting: 'Spotted Tail Agency, Nebraska, spring 1877',
      learningObjectives: [
        'Describe conditions at the Spotted Tail Agency in 1877 as reported by the acting agent',
        'Explain the competing pressures on the Lakota leaders, the agent and the US government',
        'Distinguish what the report documents from what the simulation assumes',
      ],
      studentRole: 'Interpreter working between the agency staff and the Lakota leaders',
      readingLevel: UPPER_SECONDARY,
      stageCount: 2,
    },
  },
  {
    id: 'magna-carta-1297',
    files: ['eval-corpus/magna-carta-1297-translation.pdf'],
    teacher: {
      title: null,
      setting: 'England, 1297, the confirmation of the Great Charter under Edward I',
      learningObjectives: [
        'Explain what Magna Carta promised about justice, taxation and the rights of free men',
        'Describe why barons, church and king each wanted the charter confirmed or resisted',
        'Evaluate whose interests the charter protected',
      ],
      studentRole: 'A clerk in the royal chancery who hears every party\'s case',
      readingLevel: UPPER_SECONDARY,
      stageCount: 3,
    },
  },
]
