# UniversalRotationQueue Benchmark

## Muc tieu
Danh gia bottleneck cho queue runtime voi 10k-100k pending jobs va cac scenario:
- mixed priority
- retry rate limit + retry error
- cancel ratio 10%
- capability-aware assignment (`prefer` va `strict`)

## Chay benchmark

```powershell
npm run bench:rotation-queue
```

Mac dinh chay size: `10000,50000,100000`.

## Tham so

```powershell
node dist/main/src/main/services/shared/universalRotationQueue/benchmarks/queueBenchmark.js --sizes=10000,50000 --output=bench.current.json --baseline=bench.baseline.json
```

- `--sizes`: danh sach so job, cach nhau boi dau phay.
- `--output`: file JSON output benchmark.
- `--baseline`: file baseline JSON de so sanh regression.

## Regression rule
Fail (exit code != 0) neu so voi baseline co metric vuot >20% o:
- `dispatchLatencyP95Ms`
- `rebalanceP95Ms`

## Metrics
Moi scenario output:
- `enqueuePerSec`
- `dispatchLatencyP50Ms/p95Ms/p99Ms`
- `rebalanceP95Ms`
- `snapshotBuildP95Ms`
- `heapDeltaMb`
- `durationMs`
