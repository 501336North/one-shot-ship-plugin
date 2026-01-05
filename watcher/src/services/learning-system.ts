/**
 * Learning System Service
 *
 * Provides interactive tutorials, concept explanations, and skill progression
 * to help users learn OSS workflows progressively.
 */

export enum SkillLevel {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'intermediate',
  ADVANCED = 'advanced',
  EXPERT = 'expert',
}

interface TutorialStep {
  title: string;
  content: string;
  command?: string;
  expectedOutput?: string;
}

interface Tutorial {
  id: string;
  title: string;
  description: string;
  difficulty: SkillLevel;
  steps: TutorialStep[];
  estimatedTime: string;
}

interface Concept {
  id: string;
  title: string;
  summary: string;
  details: string;
  examples: string[];
  relatedCommands: string[];
  relatedConcepts: string[];
}

interface Recommendation {
  type: 'tutorial' | 'concept';
  id: string;
  reason: string;
}

interface SkillTreeLevel {
  unlocked: boolean;
  skills: string[];
  requirements: string[];
}

interface SkillTree {
  beginner: SkillTreeLevel;
  intermediate: SkillTreeLevel;
  advanced: SkillTreeLevel;
  expert: SkillTreeLevel;
}

interface QuickstartGuide {
  title: string;
  description: string;
  steps: TutorialStep[];
  estimatedTime: string;
}

interface Progress {
  completedTutorials: string[];
  viewedConcepts: string[];
  skillLevel: SkillLevel;
}

export class LearningSystem {
  private tutorials: Map<string, Tutorial>;
  private concepts: Map<string, Concept>;
  private progress: Progress;
  private quickstartStep: number;

  constructor() {
    this.tutorials = new Map();
    this.concepts = new Map();
    this.progress = {
      completedTutorials: [],
      viewedConcepts: [],
      skillLevel: SkillLevel.BEGINNER,
    };
    this.quickstartStep = 0;
    this.initializeTutorials();
    this.initializeConcepts();
  }

  private initializeTutorials(): void {
    this.tutorials.set('tdd-basics', {
      id: 'tdd-basics',
      title: 'TDD Fundamentals',
      description: 'Learn the RED-GREEN-REFACTOR cycle',
      difficulty: SkillLevel.BEGINNER,
      estimatedTime: '15 minutes',
      steps: [
        {
          title: 'Write a Failing Test',
          content: 'Start by writing a test that describes the behavior you want. The test should FAIL initially.',
          command: '/oss:red',
        },
        {
          title: 'Make It Pass',
          content: 'Write the MINIMAL code needed to make the test pass. No extras!',
          command: '/oss:green',
        },
        {
          title: 'Refactor',
          content: 'Clean up the code while keeping tests green. Remove duplication, improve names.',
          command: '/oss:refactor',
        },
      ],
    });

    this.tutorials.set('workflow-basics', {
      id: 'workflow-basics',
      title: 'OSS Workflow Basics',
      description: 'Learn the ideate → plan → build → ship flow',
      difficulty: SkillLevel.BEGINNER,
      estimatedTime: '10 minutes',
      steps: [
        {
          title: 'Ideate',
          content: 'Start with brainstorming. What problem are you solving?',
          command: '/oss:ideate',
        },
        {
          title: 'Plan',
          content: 'Create a TDD implementation plan with phases and tasks.',
          command: '/oss:plan',
        },
        {
          title: 'Build',
          content: 'Execute the plan with strict TDD discipline.',
          command: '/oss:build',
        },
        {
          title: 'Ship',
          content: 'Quality check, commit, and create PR.',
          command: '/oss:ship',
        },
      ],
    });

    this.tutorials.set('london-tdd', {
      id: 'london-tdd',
      title: 'London TDD (Outside-In)',
      description: 'Learn the London school of TDD with mocking',
      difficulty: SkillLevel.INTERMEDIATE,
      estimatedTime: '20 minutes',
      steps: [
        {
          title: 'Start at the Boundary',
          content: 'Begin at the system boundary (API, UI) and work inward.',
        },
        {
          title: 'Mock Collaborators',
          content: 'Mock all collaborators to focus on the unit under test.',
          command: '/oss:mock',
        },
        {
          title: 'Design Through Mocks',
          content: 'Discover interfaces through mock expectations.',
        },
        {
          title: 'Integrate',
          content: 'Validate mocked interactions work in reality.',
          command: '/oss:integration',
        },
      ],
    });
  }

  private initializeConcepts(): void {
    this.concepts.set('tdd', {
      id: 'tdd',
      title: 'Test-Driven Development (TDD)',
      summary: 'Write tests before code. RED → GREEN → REFACTOR.',
      details: 'TDD is a development discipline where you write a failing test before writing any production code. The cycle is: RED (write failing test), GREEN (write minimal code to pass), REFACTOR (clean up while tests stay green).',
      examples: [
        'Write test for add(1, 2) = 3, see it fail, implement add(), refactor',
        'Write test for user registration, mock dependencies, implement handler',
      ],
      relatedCommands: ['/oss:red', '/oss:green', '/oss:refactor'],
      relatedConcepts: ['london-tdd', 'chicago-tdd'],
    });

    this.concepts.set('london-tdd', {
      id: 'london-tdd',
      title: 'London TDD (Outside-In)',
      summary: 'Start at system boundaries, mock collaborators, design interfaces through tests.',
      details: 'London TDD starts at the outer boundary of the system and works inward. All collaborators are mocked, allowing you to design interfaces through mock expectations. This results in cleaner separation of concerns.',
      examples: [
        'Start with API test, mock service, implement handler',
        'Test service with mocked repository',
      ],
      relatedCommands: ['/oss:red', '/oss:green', '/oss:mock'],
      relatedConcepts: ['tdd', 'chicago-tdd', 'mocking'],
    });

    this.concepts.set('iron-laws', {
      id: 'iron-laws',
      title: 'IRON LAWS',
      summary: 'Non-negotiable rules that ensure quality and safety.',
      details: 'The 6 IRON LAWS are: 1) TDD (no code without failing test), 2) Behavior over implementation, 3) Loop detection, 4) Agent Git Flow (never touch main), 5) Agent delegation, 6) Dev docs sync.',
      examples: [
        'IRON LAW #1: Test must fail before writing production code',
        'IRON LAW #4: Always create feature branch, never push to main',
      ],
      relatedCommands: ['/oss:red', '/oss:ship', '/oss:review'],
      relatedConcepts: ['tdd', 'git-flow'],
    });

    this.concepts.set('red-green-refactor', {
      id: 'red-green-refactor',
      title: 'RED-GREEN-REFACTOR',
      summary: 'The TDD cycle: write failing test, make it pass, clean up.',
      details: 'RED: Write a test that fails. GREEN: Write the minimum code to make it pass. REFACTOR: Clean up the code while keeping tests green.',
      examples: [
        'RED: expect(add(1, 2)).toBe(3) → fails',
        'GREEN: function add(a, b) { return a + b }',
        'REFACTOR: Rename variables, extract helpers',
      ],
      relatedCommands: ['/oss:red', '/oss:green', '/oss:refactor'],
      relatedConcepts: ['tdd', 'london-tdd'],
    });
  }

  /**
   * List all available tutorials
   */
  listTutorials(): Tutorial[] {
    return Array.from(this.tutorials.values());
  }

  /**
   * Get tutorial by ID
   */
  getTutorial(id: string): Tutorial | undefined {
    return this.tutorials.get(id);
  }

  /**
   * Explain a concept
   */
  explainConcept(id: string): Concept | undefined {
    return this.concepts.get(id);
  }

  /**
   * List all concept IDs
   */
  listConcepts(): string[] {
    return Array.from(this.concepts.keys());
  }

  /**
   * Get current skill level
   */
  getSkillLevel(): SkillLevel {
    return this.progress.skillLevel;
  }

  /**
   * Set skill level
   */
  setSkillLevel(level: SkillLevel): void {
    this.progress.skillLevel = level;
  }

  /**
   * Get learning recommendations based on skill level
   */
  getRecommendations(): Recommendation[] {
    const recommendations: Recommendation[] = [];

    if (this.progress.skillLevel === SkillLevel.BEGINNER) {
      if (!this.progress.completedTutorials.includes('tdd-basics')) {
        recommendations.push({
          type: 'tutorial',
          id: 'tdd-basics',
          reason: 'Learn the fundamentals of TDD',
        });
      }
      if (!this.progress.completedTutorials.includes('workflow-basics')) {
        recommendations.push({
          type: 'tutorial',
          id: 'workflow-basics',
          reason: 'Learn the OSS workflow',
        });
      }
    } else if (this.progress.skillLevel === SkillLevel.INTERMEDIATE) {
      if (!this.progress.completedTutorials.includes('london-tdd')) {
        recommendations.push({
          type: 'tutorial',
          id: 'london-tdd',
          reason: 'Learn advanced TDD techniques',
        });
      }
    }

    // Add concept recommendations
    if (!this.progress.viewedConcepts.includes('iron-laws')) {
      recommendations.push({
        type: 'concept',
        id: 'iron-laws',
        reason: 'Understand the non-negotiable rules',
      });
    }

    return recommendations;
  }

  /**
   * Mark tutorial as completed
   */
  completeTutorial(id: string): void {
    if (!this.progress.completedTutorials.includes(id)) {
      this.progress.completedTutorials.push(id);
    }
  }

  /**
   * Get current progress
   */
  getProgress(): Progress {
    return { ...this.progress };
  }

  /**
   * Get skill tree
   */
  getSkillTree(): SkillTree {
    return {
      beginner: {
        unlocked: true,
        skills: ['ideate', 'plan', 'build', 'ship'],
        requirements: [],
      },
      intermediate: {
        unlocked: this.progress.completedTutorials.includes('tdd-basics'),
        skills: ['red', 'green', 'refactor', 'acceptance', 'api-design'],
        requirements: ['Complete TDD Basics tutorial'],
      },
      advanced: {
        unlocked: this.progress.completedTutorials.includes('london-tdd'),
        skills: ['mock', 'contract', 'integration'],
        requirements: ['Complete London TDD tutorial'],
      },
      expert: {
        unlocked: this.progress.skillLevel === SkillLevel.EXPERT,
        skills: ['trace', 'incident', 'chaos'],
        requirements: ['Complete all tutorials', 'Ship 10+ features'],
      },
    };
  }

  /**
   * Get quickstart guide
   */
  getQuickstartGuide(): QuickstartGuide {
    return {
      title: 'OSS Quickstart',
      description: 'Get started with OSS in under 5 minutes',
      estimatedTime: '5 minutes',
      steps: [
        {
          title: 'Login',
          content: 'Authenticate with your OSS account',
          command: '/oss:login',
        },
        {
          title: 'Start Ideating',
          content: 'Tell OSS what you want to build',
          command: '/oss:ideate "my feature idea"',
        },
        {
          title: 'Create a Plan',
          content: 'Generate a TDD implementation plan',
          command: '/oss:plan',
        },
        {
          title: 'Build It',
          content: 'Execute the plan with TDD',
          command: '/oss:build',
        },
        {
          title: 'Ship It',
          content: 'Quality check and create PR',
          command: '/oss:ship',
        },
      ],
    };
  }

  /**
   * Get current quickstart step
   */
  getQuickstartStep(): number {
    return this.quickstartStep;
  }

  /**
   * Advance to next quickstart step
   */
  advanceQuickstart(): void {
    this.quickstartStep++;
  }
}
