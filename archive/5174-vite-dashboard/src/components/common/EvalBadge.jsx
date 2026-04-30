import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";

export default function EvalBadge({ workflowId }) {
  const [badge, setBadge] = useState(null);

  useEffect(() => {
    api.evaluationResults(25, "all")
      .then((results) => {
        const workflowResults = results.filter((result) => result.workflow_id === workflowId);
        if (!workflowResults.length) {
          setBadge(null);
          return;
        }
        if (workflowResults.some((result) => !result.passed && result.score === 0)) {
          setBadge("red");
        } else if (workflowResults.some((result) => !result.passed)) {
          setBadge("amber");
        } else {
          setBadge("green");
        }
      })
      .catch(() => setBadge(null));
  }, [workflowId]);

  if (!badge) {
    return null;
  }

  return <span className={`eval-badge ${badge}`} title={`Evaluation: ${badge}`} aria-label={`Evaluation: ${badge}`} />;
}
