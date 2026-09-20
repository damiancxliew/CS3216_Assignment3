import type { Blueprint } from './core'

export const demoBlueprint = {
  version: 1,
  id: 'greyhaven-shortage',
  title: 'The Greyhaven Quay Question',
  setting: 'Fictional Greyhaven Harbor',
  description: 'A wholly invented harbor simulation about reviewing a posted shortage notice, comparing public accounts, and recommending a response.',
  player: {
    name: 'Rowan Vale',
    role: 'Council observer',
    brief: 'Inspect the simulated notice, speak with the two fictional residents, and bring both perspectives to the council table.'
  },
  sources: [
    {
      id: 'sim-notice-record',
      title: 'Simulation: shortage notice',
      text: 'Invented notice for this scenario: Greyhaven has fewer grain crates than its fictional council expected this week.',
      kind: 'simulation'
    },
    {
      id: 'sim-merchant-account',
      title: 'Simulation: merchant account',
      text: 'Invented account for this scenario: a quay merchant asks that remaining crates be counted openly before prices are discussed.',
      kind: 'simulation'
    },
    {
      id: 'sim-clerk-register',
      title: 'Simulation: clerk register',
      text: 'Invented register for this scenario: a council clerk lists several fictional deliveries as delayed rather than lost.',
      kind: 'simulation'
    }
  ],
  assumptions: [
    'Greyhaven, its harbor, its residents, and every event in this adventure are fictional simulation material.',
    'The notice, dialogue, register, choices, and outcomes are invented and make no claim about a real place or historical event.'
  ],
  locations: [
    {
      id: 'quay-market',
      name: 'Quay Market',
      purpose: 'A fictional public market where the simulated notice and merchant can be consulted.',
      kind: 'market'
    },
    {
      id: 'records-office',
      name: 'Records Office',
      purpose: 'A fictional office holding the simulated delivery register.',
      kind: 'records'
    },
    {
      id: 'council-hall',
      name: 'Council Hall',
      purpose: 'A fictional meeting place for making the scenario decision.',
      kind: 'meeting'
    }
  ],
  npcs: [
    {
      id: 'mara-venn',
      name: 'Mara Venn',
      role: 'merchant',
      locationId: 'quay-market',
      dialogue: 'Simulation dialogue: “The count should be posted where everyone in our invented market can read it before any allocation is chosen.”',
      sourceIds: ['sim-merchant-account']
    },
    {
      id: 'elias-reed',
      name: 'Elias Reed',
      role: 'clerk',
      locationId: 'records-office',
      dialogue: 'Simulation dialogue: “Our invented register marks delayed deliveries, so the council could review the entries before acting.”',
      sourceIds: ['sim-clerk-register']
    }
  ],
  evidence: [
    {
      id: 'shortage-notice',
      name: 'Shortage Notice',
      locationId: 'quay-market',
      text: 'Simulation evidence: the fictional notice reports fewer grain crates than expected and asks residents to await a council response.',
      sourceIds: ['sim-notice-record']
    }
  ],
  objectives: [
    {
      id: 'inspect-notice',
      title: 'Inspect the shortage notice',
      requires: [],
      interactionId: 'shortage-notice'
    },
    {
      id: 'speak-merchant',
      title: 'Speak with Mara Venn',
      requires: ['inspect-notice'],
      interactionId: 'mara-venn'
    },
    {
      id: 'speak-clerk',
      title: 'Speak with Elias Reed',
      requires: ['inspect-notice'],
      interactionId: 'elias-reed'
    }
  ],
  decision: {
    id: 'council-recommendation',
    title: 'Recommend a harbor response',
    requires: ['speak-merchant', 'speak-clerk'],
    options: [
      {
        id: 'publish-and-review',
        label: 'Publish the count and review the register',
        outcome: 'Simulation outcome: the fictional council posts the count and reviews delayed entries before assigning the remaining crates.'
      },
      {
        id: 'reserve-and-wait',
        label: 'Reserve the crates and wait',
        outcome: 'Simulation outcome: the fictional council holds the remaining crates while waiting for the delayed deliveries in the invented register.'
      }
    ]
  }
} satisfies Blueprint
