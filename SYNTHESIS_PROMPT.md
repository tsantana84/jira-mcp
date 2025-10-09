# synthesis prompt: correlate jira and code analysis

this prompt is used in **stage 3** of the dependency analysis workflow to synthesize insights from both jira/confluence discovery (stage 1) and code analysis (stage 2).

---

## instructions for ai

you have two analysis files from the previous stages:

1. **jira_analysis.json** - jira ticket dependencies, blockers, confluence docs, extracted keywords
2. **code_analysis.json** - related prs, commits, code files, cross-repo impact (with confidence scores)

your task is to **correlate these findings with confidence tracking** and produce two distinct outputs:

1. **tech lead context** - executive summary for ticket description (when delegating work)
2. **developer implementation guide** - step-by-step plan for tackling the task

---

## analysis principles

### correlation confidence tiers

when matching jira findings to code findings, assess confidence:

**high (0.8-1.0)**: direct match
- jira component name matches code package/module exactly
- ticket id found in pr title/description/commits
- closed dependency ticket has merged pr with implementation

**medium (0.5-0.8)**: inferred match
- similar naming patterns (e.g., jira: "api-service", code: "api-gateway-service")
- related technical terms found in both sources
- same author/team working on both ticket and code

**low (0.0-0.5)**: weak connection
- keyword match only (e.g., both mention "metrics")
- old references (>12 months)
- no direct evidence linking jira and code

### conflict resolution protocol

when jira and code contradict each other:

1. **identify the conflict explicitly**
   - example: "jira says component is 'legacy-provider' but code shows 'modern-provider-v2'"

2. **rank by recency and source type**
   - recent code (last 3 months) > recent tickets > old confluence docs
   - for bugs: code represents current state (truth)
   - for planning: tickets represent intent (direction)

3. **provide resolution with caveat**
   - recommend action based on ranking
   - flag for human review if both sources are recent but contradictory

4. **note in synthesis output**
   - add to `conflicts` section with resolution and confidence level

### gap handling

distinguish between different types of gaps:

**type 1: jira mentions, code not found**
- jira ticket mentions "legacy provider" but code_analysis found no matching files
- action: flag as "needs clarification" - may need broader search or term is ambiguous

**type 2: code found, jira silent**
- code_analysis found database migrations but jira doesn't mention schema changes
- action: flag as "potential hidden dependency" - may need ticket update

**type 3: expected correlation missing**
- closed dependency ticket (DMD-123) should have pr, but code_analysis found none
- action: flag as "missing implementation evidence" - may need manual pr search

**type 4: low confidence in both sources**
- both jira and code analysis have low confidence findings
- action: note overall uncertainty, recommend human verification before proceeding

### synthesis quality assessment

before outputting, calculate overall correlation quality:

- **strong (0.8-1.0)**: most jira components matched to code, clear implementation patterns found, minimal gaps
- **moderate (0.5-0.8)**: partial matches, some gaps, enough context to proceed with caution
- **weak (0.0-0.5)**: many gaps, conflicts, or low confidence findings - recommend human review before work begins

---

## correlation tasks

### 1. match jira dependencies to code findings

**for each dependency in jira_analysis.json:**

- search code_analysis.json for prs/commits mentioning the ticket key
- if closed ticket: expect to find merged pr (high confidence if found, gap if missing)
- if open/in-progress ticket: expect to find open pr or recent commits (medium confidence)
- if blocked ticket: expect no code yet (validate this assumption)

**assess match confidence:**
- direct ticket id in pr → high confidence
- similar timing/author → medium confidence
- no match found → note as gap

### 2. validate components and technical terms

**for each component/label in jira:**

- check if code_analysis found matching code files/packages
- assess naming consistency: exact match (high) vs. similar (medium) vs. mismatch (low)
- flag discrepancies: "jira says X but code shows Y"

**for extracted technical terms:**

- verify code_analysis searched for these terms
- if code_analysis has low confidence on a term, note it in gaps
- if term not found in code at all, flag for clarification

### 3. extract implementation patterns

**priority: closed dependencies with merged prs (highest confidence)**

if jira_analysis shows closed dependency tickets:
- find their prs in code_analysis
- extract pattern: what was changed? which files? what approach?
- assess applicability to current ticket (same component type? same pattern?)
- assign confidence: high if directly applicable, medium if similar, low if different context

**secondary: recent commits mentioning keywords**

if code_analysis found commits via keyword search:
- correlate keywords to jira ticket description
- assess relevance: does commit solve similar problem?
- assign medium confidence (inferred similarity, not direct link)

### 4. identify ticket type and adjust focus

based on jira ticket labels, issueType, and summary:

**bug fix**
- focus: root cause from code analysis + reproduction steps
- correlation: match bug description to code files found
- risk: regression - check if tests mentioned in code_analysis

**feature/story**
- focus: api design, implementation roadmap from similar prs
- correlation: match requested functionality to existing patterns
- risk: backward compatibility - check cross-service dependencies

**refactoring**
- focus: impact scope from code_analysis, migration strategy
- correlation: identify affected files and dependents
- risk: breaking changes - check cross-repo dependencies

**infrastructure/devops**
- focus: deployment dependencies, rollout plan
- correlation: match to existing deployment patterns
- risk: coordination - check if multiple repos/services involved

**metrics/monitoring**
- focus: instrumentation points from code, dashboard updates
- correlation: match to existing metrics patterns
- risk: low unless api changes

**database/schema**
- focus: migration coordination, data impact
- correlation: match to migration files in code_analysis
- risk: high - check for coordinated deployments

### 5. assess complexity and risk

**effort estimate (based on code_analysis patterns):**
- if similar pr changed X lines across Y files → expect similar effort
- if cross-repo changes needed → increase estimate
- if code_analysis has many gaps → add buffer for unknowns

**risk assessment:**
- breaking api changes? → check cross_service_dependencies in code_analysis
- database migrations? → check database_impact
- coordinated deployments? → check related_repositories
- low code_analysis confidence? → increase risk level

**correlation quality impact:**
- strong correlation → higher confidence in estimates
- weak correlation → add disclaimers, recommend human review

---

## output format

create a file called **synthesis_analysis.json** with this enhanced structure:

```json
{
  "ticket": {
    "key": "DMD-11924",
    "summary": "[Demographics] Metrics in legacy providers",
    "type_detected": "metrics/monitoring"
  },

  "correlation": {
    "overall_quality": {
      "score": 0.82,
      "assessment": "strong - most components matched, clear patterns found",
      "confidence_distribution": {
        "high_confidence_findings": 5,
        "medium_confidence_findings": 3,
        "low_confidence_findings": 1
      }
    },

    "jira_to_code_matches": [
      {
        "jira_component": "demographics-service",
        "code_files_found": [
          "src/demographics/GeolocationProvider.java",
          "src/demographics/IPProvider.java"
        ],
        "confidence": {
          "level": "high",
          "score": 0.9,
          "reasoning": "exact package name match, files exist in codebase",
          "match_type": "direct"
        },
        "validation": "confirmed - components exist in codebase"
      }
    ],

    "implementation_patterns_from_dependencies": [
      {
        "source_ticket": "DMD-11922",
        "source_ticket_status": "closed",
        "source_pr": "#1234",
        "pattern": "added micrometer @Timed annotations to provider methods",
        "files_changed": ["src/demographics/v3/GeolocationProviderV3.java"],
        "lines_changed": 120,
        "key_code_snippet": "lines 45-60: @Timed(value = \"geolocation.provider.lookup\", description = \"...\")",
        "confidence": {
          "level": "high",
          "score": 0.95,
          "reasoning": "closed dependency with merged pr, same component type, proven pattern",
          "match_type": "direct"
        },
        "applicable_to_current_ticket": true,
        "applicability_reasoning": "same provider pattern, legacy vs v3 endpoints - directly applicable"
      }
    ],

    "conflicts": [
      {
        "source_1": "jira ticket mentions 'legacy provider' (generic term)",
        "source_2": "code analysis found multiple providers (GeolocationProvider, IPProvider)",
        "conflict_type": "ambiguity",
        "resolution": "assume both providers need metrics based on code analysis findings",
        "confidence": "medium",
        "action_needed": "confirm with ticket author if both providers should be instrumented"
      }
    ],

    "gaps_identified": [
      {
        "gap_type": "missing_context",
        "severity": "low",
        "description": "jira mentions 'legacy provider' but unclear which specific providers",
        "impact": "may miss some providers if assumption is wrong",
        "resolution": "code analysis found GeolocationProvider and IPProvider - assume both need metrics",
        "confidence_in_resolution": "medium",
        "recommended_action": "verify scope with tech lead before implementation"
      }
    ]
  },

  "tech_lead_context": {
    "executive_summary": "add prometheus metrics to legacy demographics providers (GeolocationProvider, IPProvider) following the pattern from DMD-11922 (v3 endpoints). requires adding @Timed annotations to track request counts, failures, and response times. similar work in PR #1234 changed ~120 lines across 2 files. no api changes, no database impact, isolated to demographics-service.",

    "confidence_assessment": {
      "overall_confidence": "high",
      "reasoning": "clear implementation pattern from closed dependency (PR #1234), exact component match, no cross-repo dependencies",
      "caveats": [
        "assumption: both GeolocationProvider and IPProvider need metrics (verify with requester)"
      ]
    },

    "dependencies": {
      "upstream": [
        {
          "ticket": "DMD-11922",
          "status": "closed",
          "relationship": "provides implementation pattern",
          "pr": "#1234",
          "confidence": "high"
        }
      ],
      "downstream": [
        {
          "ticket": "DMD-11923",
          "status": "to do",
          "relationship": "will follow same pattern for global exception handler",
          "confidence": "medium"
        }
      ],
      "cross_repo": []
    },

    "related_work": [
      {
        "pr": "#1234",
        "ticket": "DMD-11922",
        "relevance": "same pattern for v3 endpoints - use as template",
        "files_changed": 2,
        "lines_changed": 120,
        "confidence": "high"
      }
    ],

    "recommended_approach": "1. review PR #1234 to understand micrometer integration pattern\n2. apply same @Timed annotations to GeolocationProvider and IPProvider legacy methods\n3. add metrics for: total_requests, failed_requests, avg_response_time_ms\n4. ensure metrics are exported to prometheus (verify existing config)\n5. test locally and verify metrics appear in /actuator/prometheus endpoint",

    "potential_blockers": [],

    "effort_estimate": {
      "size": "small",
      "duration": "1-2 days",
      "confidence": "high",
      "basis": "similar to PR #1234 which changed 120 lines across 2 files"
    },

    "risk_assessment": {
      "level": "low",
      "factors": [
        "isolated change (no cross-service impact)",
        "no api modifications",
        "pattern already proven in PR #1234",
        "additive change (new metrics only)"
      ],
      "mitigation": "follow existing pattern exactly, comprehensive local testing"
    }
  },

  "developer_guide": {
    "prerequisites": {
      "required_knowledge": [
        "micrometer metrics library",
        "spring boot actuator (if applicable)",
        "prometheus metric types (timer, counter)"
      ],
      "required_access": [
        "demographics-service repository",
        "local dev environment with prometheus"
      ],
      "reference_materials": [
        {
          "type": "pr",
          "reference": "#1234",
          "purpose": "implementation pattern template",
          "confidence": "high"
        }
      ]
    },

    "implementation_steps": [
      {
        "step": 1,
        "action": "review implementation pattern from DMD-11922",
        "commands": [
          "gh pr view 1234 --repo your-company/demographics-service",
          "gh pr diff 1234 --repo your-company/demographics-service"
        ],
        "expected_outcome": "understand how @Timed annotations were added to v3 providers",
        "confidence": "high",
        "time_estimate": "30 min"
      },
      {
        "step": 2,
        "action": "locate legacy provider files",
        "files": [
          "src/demographics/GeolocationProvider.java",
          "src/demographics/IPProvider.java"
        ],
        "verification": "grep -r 'class GeolocationProvider\\|class IPProvider' --include='*.java'",
        "confidence": "high",
        "notes": "confirmed by code analysis"
      },
      {
        "step": 3,
        "action": "verify micrometer dependency exists",
        "files": ["pom.xml or build.gradle"],
        "verification": "grep -r 'io.micrometer' pom.xml",
        "expected": "likely already present based on PR #1234",
        "confidence": "high",
        "fallback": "add dependency if missing: <dependency><groupId>io.micrometer</groupId><artifactId>micrometer-core</artifactId></dependency>"
      },
      {
        "step": 4,
        "action": "add @Timed annotations to provider methods",
        "files": [
          "src/demographics/GeolocationProvider.java",
          "src/demographics/IPProvider.java"
        ],
        "code_example": "// based on PR #1234 pattern:\n@Timed(value = \"demographics.geolocation.legacy.lookup\",\n       description = \"time taken for legacy geolocation provider lookup\",\n       histogram = true)\npublic GeolocationResponse lookup(String ip) {\n    // existing code\n}",
        "metrics_to_add": [
          "demographics.geolocation.legacy.lookup (timer)",
          "demographics.ip.legacy.lookup (timer)"
        ],
        "confidence": "high",
        "time_estimate": "1-2 hours"
      },
      {
        "step": 5,
        "action": "verify prometheus export configuration",
        "files": ["application.yml or application.properties"],
        "verification": "ensure management.metrics.export.prometheus.enabled=true",
        "expected": "likely already configured based on existing v3 metrics",
        "confidence": "high"
      },
      {
        "step": 6,
        "action": "write unit tests",
        "files_to_create": [
          "src/test/java/demographics/GeolocationProviderMetricsTest.java",
          "src/test/java/demographics/IPProviderMetricsTest.java"
        ],
        "test_strategy": "verify @Timed annotation present, verify metrics recorded after method call",
        "code_example": "// test example:\n@Test\npublic void testMetricsRecorded() {\n    provider.lookup(\"1.2.3.4\");\n    Timer timer = meterRegistry.find(\"demographics.geolocation.legacy.lookup\").timer();\n    assertThat(timer.count()).isEqualTo(1);\n}",
        "confidence": "medium",
        "time_estimate": "1-2 hours"
      },
      {
        "step": 7,
        "action": "test locally",
        "commands": [
          "mvn clean install (or gradle build)",
          "run service locally",
          "curl http://localhost:8080/actuator/prometheus | grep demographics",
          "verify metrics appear: demographics_geolocation_legacy_lookup_seconds_count, etc."
        ],
        "expected_outcome": "see new metrics in prometheus output",
        "confidence": "high",
        "time_estimate": "30 min"
      },
      {
        "step": 8,
        "action": "create pr following DMD-11922 pattern",
        "pr_title": "[DMD-11924] add metrics to legacy demographics providers",
        "pr_description": "adds prometheus metrics to GeolocationProvider and IPProvider following pattern from DMD-11922 (PR #1234).\n\nmetrics added:\n- demographics.geolocation.legacy.lookup (timer)\n- demographics.ip.legacy.lookup (timer)\n\ntesting: unit tests + local verification via /actuator/prometheus",
        "confidence": "high"
      }
    ],

    "files_to_modify": [
      {
        "path": "src/demographics/GeolocationProvider.java",
        "changes": "add @Timed annotation to lookup methods",
        "reference": "see PR #1234 GeolocationProviderV3.java lines 45-60",
        "confidence": "high",
        "estimated_lines_changed": 60
      },
      {
        "path": "src/demographics/IPProvider.java",
        "changes": "add @Timed annotation to lookup methods",
        "reference": "same pattern as GeolocationProvider",
        "confidence": "high",
        "estimated_lines_changed": 60
      },
      {
        "path": "pom.xml (or build.gradle)",
        "changes": "verify micrometer dependency exists (likely already present)",
        "reference": "PR #1234 dependency changes",
        "confidence": "high",
        "estimated_lines_changed": 0
      }
    ],

    "testing_strategy": {
      "unit_tests": {
        "approach": "verify @Timed annotations present, verify metrics recorded",
        "confidence": "high",
        "coverage_target": "100% of annotated methods"
      },
      "integration_tests": {
        "approach": "optional - verify metrics endpoint exposes new metrics",
        "confidence": "medium",
        "notes": "may not be necessary if unit tests are comprehensive"
      },
      "manual_testing": {
        "approach": "run locally, curl /actuator/prometheus, grep for demographics_geolocation_legacy_lookup",
        "confidence": "high",
        "required": true
      }
    },

    "deployment_plan": {
      "sequence": "standard deployment - no special steps needed",
      "backward_compatible": true,
      "coordination_needed": false,
      "monitoring": "after deployment, check grafana for new metrics dashboards (may need to create dashboard)",
      "rollback_plan": "standard rollback - revert pr. metrics are additive, no breaking changes.",
      "confidence": "high"
    }
  },

  "recommendations": [
    {
      "recommendation": "follow PR #1234 pattern exactly - proven approach",
      "priority": "high",
      "confidence": "high"
    },
    {
      "recommendation": "verify scope with ticket author: confirm both GeolocationProvider and IPProvider need metrics",
      "priority": "medium",
      "confidence": "medium",
      "reason": "jira description is ambiguous about which providers"
    },
    {
      "recommendation": "coordinate with DMD-11923 owner to ensure consistent metric naming",
      "priority": "medium",
      "confidence": "medium"
    },
    {
      "recommendation": "after deployment, create grafana dashboard for new legacy provider metrics",
      "priority": "low",
      "confidence": "high"
    }
  ],

  "quality_checklist": {
    "all_correlations_have_confidence": true,
    "gaps_explicitly_noted": true,
    "conflicts_flagged_for_review": true,
    "effort_estimate_based_on_evidence": true,
    "risk_assessment_considers_confidence": true,
    "recommendations_tied_to_confidence_levels": true
  },

  "analysis_metadata": {
    "analyzed_at": "2025-10-06T12:00:00Z",
    "jira_analysis_file": "jira_analysis.json",
    "code_analysis_file": "code_analysis.json",
    "correlation_quality_score": 0.82,
    "human_review_recommended": false,
    "human_review_reason": null
  }
}
```

---

## quality checklist

before outputting synthesis_analysis.json, verify:

- [ ] every correlation has explicit confidence with reasoning
- [ ] gaps are noted in `gaps_identified` with severity and recommended actions
- [ ] conflicts are flagged in `conflicts` section with resolution strategy
- [ ] effort estimate references specific evidence from code_analysis (e.g., "similar to PR #1234")
- [ ] risk assessment considers correlation quality score
- [ ] recommendations are prioritized by confidence level
- [ ] overall correlation quality score reflects actual match quality
- [ ] if correlation quality < 0.5, set `human_review_recommended: true`

---

## usage instructions

### for tech leads (delegating work):

1. run stage 1 (jira analysis) and stage 2 (code analysis) first
2. copy this entire prompt into claude/gemini along with both json files
3. review the generated `tech_lead_context` section
4. **check correlation quality score** - if < 0.5, review manually before delegating
5. paste the executive summary + recommended approach into the jira ticket description
6. mention the related pr (#1234) as reference for the developer
7. if conflicts or gaps are flagged, add clarifying comments to the ticket

### for developers (implementing the task):

1. your tech lead should have already run stages 1-3 and attached synthesis_analysis.json
2. **check overall confidence** in tech_lead_context - if low, ask for clarification before starting
3. review the `developer_guide` section
4. follow the step-by-step implementation plan
5. use the code examples and pr references as templates
6. if you encounter gaps during implementation, update the ticket with findings

### for self-directed work:

1. run all 3 stages yourself
2. **review correlation quality score** - if < 0.5, do additional manual research
3. use tech_lead_context to understand scope/effort before starting
4. use developer_guide as your implementation checklist
5. if conflicts are flagged, resolve them before proceeding (ask team if needed)

---

## handling low-quality correlations

if correlation quality score < 0.5:

**symptoms:**
- many gaps in jira_to_code_matches
- no implementation patterns found from dependencies
- conflicts between jira and code findings
- low confidence in code_analysis findings

**actions:**
1. note in synthesis that **human review is strongly recommended**
2. still generate tech_lead_context and developer_guide, but add disclaimers
3. in recommendations, prioritize "clarify scope with team" and "manual code search needed"
4. increase effort estimate and risk level to account for uncertainty
5. suggest specific clarifying questions to ask (based on gaps)

**example disclaimer:**
```
"warning: correlation quality is low (0.42). many gaps and ambiguities detected. recommend manual review and clarification with ticket author before starting implementation. see gaps_identified section for specific unknowns."
```

---

## customization by ticket type

the ai should automatically detect ticket type and adjust synthesis focus:

### bug tickets
- emphasize: root cause correlation (jira description → code files found)
- correlation priority: match bug symptoms to code locations
- risk focus: regression prevention (check if tests mentioned)
- developer guide: add "reproduce bug locally" step first

### feature/story tickets
- emphasize: api design from similar prs, backward compatibility
- correlation priority: match requested functionality to existing patterns
- risk focus: breaking changes in cross-service dependencies
- developer guide: include api design validation step

### refactoring tickets
- emphasize: impact scope from code_analysis, affected files
- correlation priority: identify all dependents of refactored code
- risk focus: breaking changes, migration complexity
- developer guide: include impact analysis and rollout strategy

### infrastructure/devops tickets
- emphasize: deployment dependencies, coordination needs
- correlation priority: match to existing deployment patterns
- risk focus: multi-service coordination, rollback complexity
- developer guide: include deployment sequence and verification steps

### metrics/monitoring tickets
- emphasize: instrumentation points, existing metric patterns
- correlation priority: match to similar metrics implementations
- risk focus: usually low unless api changes involved
- developer guide: include grafana dashboard creation step

### database/schema tickets
- emphasize: migration coordination, data impact
- correlation priority: match to migration files in code_analysis
- risk focus: high - check for coordinated deployments
- developer guide: include migration testing and rollback plan

the synthesis should adapt its output based on detected ticket type, prioritizing relevant information and adjusting risk assessment accordingly.
