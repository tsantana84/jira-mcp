# synthesis prompt: correlate jira and code analysis

this prompt is used in **stage 3** of the dependency analysis workflow to synthesize insights from both jira/confluence discovery (stage 1) and code analysis (stage 2).

---

## instructions for ai

you have two analysis files from the previous stages:

1. **jira_analysis.json** - jira ticket dependencies, blockers, confluence docs
2. **code_analysis.json** - related prs, commits, code files, cross-repo impact

your task is to **correlate these findings** and produce two distinct outputs:

1. **tech lead context** - executive summary for ticket description (when delegating work)
2. **developer implementation guide** - step-by-step plan for tackling the task

---

## analysis tasks

### 1. correlate jira dependencies with code findings

- **match jira ticket keys to prs/commits**
  - which dependencies already have prs? (closed tickets → implementation patterns)
  - which dependencies are still blocked? (open/in-progress tickets → current work)

- **validate components mentioned in jira**
  - do jira components (e.g., "demographics-service") exist in codebase?
  - are there mismatches? (jira says "api-service" but code shows "api-gateway")

- **extract implementation patterns from closed dependencies**
  - if DMD-11922 is closed and similar to DMD-11924, what pr closed DMD-11922?
  - what files were changed? what pattern was used? (e.g., micrometer metrics in lines 45-60)

### 2. identify ticket type and context

based on labels, issueType, summary, and description, detect the ticket type:

- **bug fix** → focus on root cause, reproduction steps, regression tests
- **feature/story** → focus on api design, implementation roadmap, backward compatibility
- **refactoring** → focus on impact scope, migration strategy, backward compatibility
- **infrastructure/devops** → focus on deployment dependencies, rollout plan, rollback procedure
- **metrics/monitoring** → focus on instrumentation points, dashboard updates, alert rules
- **database/schema** → focus on migration coordination, data impact, rollback strategy

### 3. identify root causes and gaps

- **root causes** (for bugs):
  - correlate jira descriptions with code findings
  - example: jira says "metrics not showing" + code shows "no prometheus annotations" → root cause: missing instrumentation

- **gaps** (missing information):
  - jira mentions "legacy provider" but code_analysis found no matches → need clarification
  - code_analysis found db migrations but jira doesn't mention schema changes → potential hidden dependency

### 4. assess complexity and risk

- **effort estimate** (based on similar prs):
  - if closed dependency pr changed 150 lines across 5 files → similar effort expected
  - if cross-repo changes needed → higher complexity

- **risk assessment**:
  - breaking api changes? (check cross_service_dependencies in code_analysis.json)
  - database migrations? (check database_impact)
  - coordinated deployments needed? (check related_repositories)

---

## output format

create a file called **synthesis_analysis.json** with this structure:

```json
{
  "ticket": {
    "key": "DMD-11924",
    "summary": "[Demographics] Metrics in legacy providers",
    "type_detected": "metrics/monitoring"
  },
  "correlation": {
    "jira_to_code_matches": [
      {
        "jira_component": "demographics-service",
        "code_files_found": ["src/demographics/GeolocationProvider.java", "src/demographics/IPProvider.java"],
        "validation": "confirmed - components exist in codebase"
      }
    ],
    "implementation_patterns_from_dependencies": [
      {
        "source_ticket": "DMD-11922",
        "source_pr": "#1234",
        "pattern": "added micrometer @Timed annotations to provider methods",
        "files_changed": ["src/demographics/v3/GeolocationProviderV3.java"],
        "key_code_snippet": "lines 45-60: @Timed(value = \"geolocation.provider.lookup\", description = \"...\")",
        "applicable_to_current_ticket": true,
        "reason": "same provider pattern, legacy vs v3 endpoints"
      }
    ],
    "gaps_identified": [
      {
        "type": "missing_context",
        "description": "jira mentions 'legacy provider' but unclear which specific providers",
        "resolution": "code analysis found GeolocationProvider and IPProvider - assume both need metrics"
      }
    ]
  },
  "tech_lead_context": {
    "executive_summary": "add prometheus metrics to legacy demographics providers (GeolocationProvider, IPProvider) following the pattern from DMD-11922 (v3 endpoints). requires adding @Timed annotations to track request counts, failures, and response times. similar work in PR #1234 changed ~120 lines across 2 files. no api changes, no database impact, isolated to demographics-service.",
    "dependencies": {
      "upstream": [
        {
          "ticket": "DMD-11922",
          "status": "closed",
          "relationship": "provides implementation pattern (PR #1234)"
        }
      ],
      "downstream": [
        {
          "ticket": "DMD-11923",
          "status": "to do",
          "relationship": "will follow same pattern for global exception handler"
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
        "lines_changed": 120
      }
    ],
    "recommended_approach": "1. review PR #1234 to understand micrometer integration pattern\n2. apply same @Timed annotations to GeolocationProvider and IPProvider legacy methods\n3. add metrics for: total_requests, failed_requests, avg_response_time_ms\n4. ensure metrics are exported to prometheus (verify existing config)\n5. test locally and verify metrics appear in /actuator/prometheus endpoint",
    "potential_blockers": [],
    "effort_estimate": "small (1-2 days)",
    "risk_level": "low",
    "risk_reasoning": "isolated change, no api modifications, pattern already proven in PR #1234"
  },
  "developer_guide": {
    "implementation_steps": [
      {
        "step": 1,
        "action": "review implementation pattern from DMD-11922",
        "command": "gh pr view 1234 --repo your-company/demographics-service",
        "command_alt": "gh pr diff 1234 --repo your-company/demographics-service",
        "expected_outcome": "understand how @Timed annotations were added to v3 providers"
      },
      {
        "step": 2,
        "action": "locate legacy provider files",
        "files": [
          "src/demographics/GeolocationProvider.java",
          "src/demographics/IPProvider.java"
        ],
        "verification": "grep -r 'class GeolocationProvider\\|class IPProvider' --include='*.java'"
      },
      {
        "step": 3,
        "action": "add micrometer dependency (if not present)",
        "files": ["pom.xml or build.gradle"],
        "verification": "check if io.micrometer:micrometer-core already in dependencies (likely yes based on PR #1234)"
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
          "demographics.ip.legacy.lookup (timer)",
          "add @Counted for failure tracking if needed"
        ]
      },
      {
        "step": 5,
        "action": "verify metrics configuration",
        "files": ["application.yml or application.properties"],
        "verification": "ensure management.metrics.export.prometheus.enabled=true",
        "expected": "likely already configured based on existing metrics in v3"
      },
      {
        "step": 6,
        "action": "write unit tests",
        "files_to_create": [
          "src/test/java/demographics/GeolocationProviderMetricsTest.java",
          "src/test/java/demographics/IPProviderMetricsTest.java"
        ],
        "test_strategy": "verify @Timed annotation present, verify metrics recorded after method call",
        "code_example": "// test example:\n@Test\npublic void testMetricsRecorded() {\n    provider.lookup(\"1.2.3.4\");\n    Timer timer = meterRegistry.find(\"demographics.geolocation.legacy.lookup\").timer();\n    assertThat(timer.count()).isEqualTo(1);\n}"
      },
      {
        "step": 7,
        "action": "test locally",
        "commands": [
          "mvn clean install (or gradle build)",
          "run service locally",
          "curl http://localhost:8080/actuator/prometheus | grep demographics",
          "verify metrics appear: demographics_geolocation_legacy_lookup_seconds_count, etc."
        ]
      },
      {
        "step": 8,
        "action": "create pr following DMD-11922 pattern",
        "pr_title": "[DMD-11924] add metrics to legacy demographics providers",
        "pr_description": "adds prometheus metrics to GeolocationProvider and IPProvider following pattern from DMD-11922 (PR #1234).\n\nmetrics added:\n- demographics.geolocation.legacy.lookup (timer)\n- demographics.ip.legacy.lookup (timer)\n\ntesting: unit tests + local verification via /actuator/prometheus"
      }
    ],
    "files_to_modify": [
      {
        "path": "src/demographics/GeolocationProvider.java",
        "changes": "add @Timed annotation to lookup methods",
        "reference": "see PR #1234 GeolocationProviderV3.java lines 45-60"
      },
      {
        "path": "src/demographics/IPProvider.java",
        "changes": "add @Timed annotation to lookup methods",
        "reference": "same pattern as GeolocationProvider"
      },
      {
        "path": "pom.xml (or build.gradle)",
        "changes": "verify micrometer dependency exists (likely already present)",
        "reference": "PR #1234 dependency changes"
      }
    ],
    "testing_strategy": {
      "unit_tests": "verify @Timed annotations present, verify metrics recorded",
      "integration_tests": "optional - verify metrics endpoint exposes new metrics",
      "manual_testing": "run locally, curl /actuator/prometheus, grep for demographics_geolocation_legacy_lookup"
    },
    "deployment_plan": {
      "sequence": "standard deployment - no special steps needed",
      "backward_compatible": true,
      "coordination_needed": false,
      "monitoring": "after deployment, check grafana for new metrics dashboards (may need to create dashboard)"
    },
    "rollback_plan": "standard rollback - revert pr. metrics are additive, no breaking changes."
  },
  "recommendations": [
    "follow PR #1234 pattern exactly - proven approach",
    "coordinate with DMD-11923 owner to ensure consistent metric naming",
    "after deployment, create grafana dashboard for new legacy provider metrics",
    "consider adding @Counted annotations for failure tracking (separate ticket?)"
  ],
  "analysis_metadata": {
    "analyzed_at": "2025-10-06T12:00:00Z",
    "jira_analysis_file": "jira_analysis.json",
    "code_analysis_file": "code_analysis.json"
  }
}
```

---

## usage instructions

### for tech leads (delegating work):

1. run stage 1 (jira analysis) and stage 2 (code analysis) first
2. copy this entire prompt into claude/gemini along with both json files
3. review the generated `tech_lead_context` section
4. paste the executive summary + recommended approach into the jira ticket description
5. mention the related pr (#1234) as reference for the developer

### for developers (implementing the task):

1. your tech lead should have already run stages 1-3 and attached synthesis_analysis.json
2. review the `developer_guide` section
3. follow the step-by-step implementation plan
4. use the code examples and pr references as templates
5. follow the testing and deployment strategy

### for self-directed work:

1. run all 3 stages yourself
2. use tech_lead_context to understand scope/effort before starting
3. use developer_guide as your implementation checklist
4. update the synthesis_analysis.json as you complete steps (optional)

---

## customization

this is a template. adjust based on your ticket type:

- **bug tickets**: emphasize root cause analysis and regression prevention
- **feature tickets**: emphasize api design and backward compatibility
- **infrastructure tickets**: emphasize deployment coordination and rollback
- **refactoring tickets**: emphasize impact scope and migration strategy

the ai should automatically detect ticket type from labels/issueType and adjust focus accordingly.
