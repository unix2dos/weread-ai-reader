# WeRead AI Model Benchmark

Generated at: 2026-05-31T14:48:27.383Z

## Summary

| Model | Samples | OK | TTFT Avg | Total Avg | Schema Complete | Quality Avg |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| kimi-k2.6 | 2 | 2 | 1868ms | 14221ms | 100% | 100 |
| deepseek-v4-flash | 2 | 0 |  |  | 0% |  |

## Details

| Model | Sample | OK | TTFT | Total | Chars | JSON | Schema | Quality | Recommendation | Score | Error |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |
| kimi-k2.6 | direction-structure | yes | 2319ms | 15929ms | 1099 | yes | yes | 100 | deep_read | 78 |  |
| kimi-k2.6 | method-density | yes | 1416ms | 12513ms | 1026 | yes | yes | 100 | deep_read | 78 |  |
| deepseek-v4-flash | direction-structure | no |  | 12461ms | 0 | no | no | 0 |  |  | Invalid JSON: Unexpected end of JSON input |
| deepseek-v4-flash | method-density | no | 12419ms | 13695ms | 441 | no | no | 0 |  |  | Invalid JSON: Unterminated string in JSON at position 441 (line 21 column 19) |
