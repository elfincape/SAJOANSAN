# API shortlist implementation

1. Extract existing permutations once for Edge/worker reuse; pure directed matrix scoring and top3, fail closed, fixed points, option meters, TTL and web limit tests.
2. Extend existing authenticated naver-relations with trusted validation-source shortlist API jobs; reuse budget/lease/backoff, sequential three-option requests and saved matrix reuse. Mock only until existing billing allowance is confirmed.
3. Add owner/center guarded shortlist capture RPC and immutable server plan linkage. Check with rollback fixtures.
4. Extend existing optimizer/verification for three trusted candidates and explicit approximate selection scope; preserve full mode and exact winner image/legs/checkpoints.
5. Connect existing UI validation → API progress → web capture and exports. Preserve individual errors and successes. Full mode remains selectable.
6. Related tests/build/fresh review; report actual key presence/quota/cost authorization separately. No new deployment or billable live test before new scope authorization is clear.

Required rollout: backend/SQL/Edge/worker-only commit first. Confirm old worker stopped and new worker ready before any API live smoke or frontend-only commit. Never deploy the whole change in one commit; old workers otherwise ignore candidate plans.
