# WeRead AI Model Benchmark

Generated at: 2026-05-31T14:49:35.316Z

## Summary

| Model | Samples | OK | TTFT Avg | Total Avg | Schema Complete | Quality Avg |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| mimo-v2.5 | 2 | 2 | 2026ms | 8242ms | 100% | 100 |
| kimi-k2.6 | 2 | 2 | 1510ms | 10578ms | 100% | 100 |
| kimi-k2.5 | 2 | 2 | 1232ms | 10994ms | 100% | 100 |
| mimo-v2.5-pro | 2 | 2 | 1819ms | 14794ms | 100% | 100 |
| minimax-m2.7 | 2 | 2 | 14301ms | 25248ms | 100% | 100 |
| minimax-m2.5 | 2 | 1 | 15874ms | 29725ms | 50% | 100 |
| glm-5.1 | 2 | 0 |  |  | 0% |  |
| glm-5 | 2 | 0 |  |  | 0% |  |
| deepseek-v4-pro | 2 | 0 |  |  | 0% |  |
| deepseek-v4-flash | 2 | 0 |  |  | 0% |  |
| qwen3.7-max | 2 | 0 |  |  | 0% |  |
| qwen3.6-plus | 2 | 0 |  |  | 0% |  |
| qwen3.5-plus | 2 | 0 |  |  | 0% |  |
| mimo-v2-pro | 2 | 0 |  |  | 0% |  |
| mimo-v2-omni | 2 | 0 |  |  | 0% |  |
| hy3-preview | 2 | 0 |  |  | 0% |  |

## Details

| Model | Sample | OK | TTFT | Total | Chars | JSON | Schema | Quality | Recommendation | Score | Error |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |
| minimax-m2.7 | direction-structure | yes | 12208ms | 20239ms | 1035 | yes | yes | 100 | deep_read | 78 |  |
| minimax-m2.7 | method-density | yes | 16393ms | 30256ms | 1027 | yes | yes | 100 | deep_read | 62 |  |
| minimax-m2.5 | direction-structure | yes | 15874ms | 29725ms | 1297 | yes | yes | 100 | deep_read | 82 |  |
| minimax-m2.5 | method-density | no | 24962ms | 37055ms | 1026 | no | no | 0 |  |  | Invalid JSON: Unterminated string in JSON at position 1026 (line 30 column 122) |
| kimi-k2.6 | direction-structure | yes | 2031ms | 13505ms | 1151 | yes | yes | 100 | deep_read | 78 |  |
| kimi-k2.6 | method-density | yes | 988ms | 7650ms | 874 | yes | yes | 100 | deep_read | 78 |  |
| kimi-k2.5 | direction-structure | yes | 1445ms | 11327ms | 992 | yes | yes | 100 | deep_read | 78 |  |
| kimi-k2.5 | method-density | yes | 1018ms | 10661ms | 1007 | yes | yes | 100 | deep_read | 78 |  |
| glm-5.1 | direction-structure | no |  | 15194ms | 0 | no | no | 0 |  |  | Invalid JSON: Unexpected end of JSON input |
| glm-5.1 | method-density | no |  | 17613ms | 0 | no | no | 0 |  |  | Invalid JSON: Unexpected end of JSON input |
| glm-5 | direction-structure | no |  | 24252ms | 0 | no | no | 0 |  |  | Invalid JSON: Unexpected end of JSON input |
| glm-5 | method-density | no |  | 19343ms | 0 | no | no | 0 |  |  | Invalid JSON: Unexpected end of JSON input |
| deepseek-v4-pro | direction-structure | no |  | 28930ms | 0 | no | no | 0 |  |  | Invalid JSON: Unexpected end of JSON input |
| deepseek-v4-pro | method-density | no |  | 31194ms | 0 | no | no | 0 |  |  | Invalid JSON: Unexpected end of JSON input |
| deepseek-v4-flash | direction-structure | no |  | 14519ms | 0 | no | no | 0 |  |  | Invalid JSON: Unexpected end of JSON input |
| deepseek-v4-flash | method-density | no |  | 14571ms | 0 | no | no | 0 |  |  | Invalid JSON: Unexpected end of JSON input |
| qwen3.7-max | direction-structure | no |  | 837ms | 0 | no | no | 0 |  |  | HTTP 401: {"type":"error","error":{"type":"ModelError","message":"Model qwen3.7-max is not supported for format oa-compat"}} |
| qwen3.7-max | method-density | no |  | 491ms | 0 | no | no | 0 |  |  | HTTP 401: {"type":"error","error":{"type":"ModelError","message":"Model qwen3.7-max is not supported for format oa-compat"}} |
| qwen3.6-plus | direction-structure | no |  | 45003ms | 0 | no | no | 0 |  |  | This operation was aborted |
| qwen3.6-plus | method-density | no |  | 45002ms | 0 | no | no | 0 |  |  | This operation was aborted |
| qwen3.5-plus | direction-structure | no |  | 45002ms | 0 | no | no | 0 |  |  | This operation was aborted |
| qwen3.5-plus | method-density | no |  | 45002ms | 0 | no | no | 0 |  |  | This operation was aborted |
| mimo-v2-pro | direction-structure | no |  | 911ms | 0 | no | no | 0 |  |  | HTTP 400: {"error":{"message":"Error from provider: No endpoints found for xiaomi/mimo-v2-pro.","code":404},"user_id":"[hidden]"} |
| mimo-v2-pro | method-density | no |  | 689ms | 0 | no | no | 0 |  |  | HTTP 400: {"error":{"message":"Error from provider: No endpoints found for xiaomi/mimo-v2-pro.","code":404},"user_id":"[hidden]"} |
| mimo-v2-omni | direction-structure | no |  | 370ms | 0 | no | no | 0 |  |  | HTTP 400: {"error":{"message":"Error from provider: No endpoints found for xiaomi/mimo-v2-omni.","code":404},"user_id":"[hidden]"} |
| mimo-v2-omni | method-density | no |  | 392ms | 0 | no | no | 0 |  |  | HTTP 400: {"error":{"message":"Error from provider: No endpoints found for xiaomi/mimo-v2-omni.","code":404},"user_id":"[hidden]"} |
| mimo-v2.5-pro | direction-structure | yes | 1448ms | 13484ms | 1113 | yes | yes | 100 | deep_read | 85 |  |
| mimo-v2.5-pro | method-density | yes | 2189ms | 16103ms | 1049 | yes | yes | 100 | deep_read | 88 |  |
| mimo-v2.5 | direction-structure | yes | 1943ms | 7603ms | 988 | yes | yes | 100 | deep_read | 85 |  |
| mimo-v2.5 | method-density | yes | 2108ms | 8880ms | 1065 | yes | yes | 100 | deep_read | 85 |  |
| hy3-preview | direction-structure | no |  | 854ms | 0 | no | no | 0 |  |  | HTTP 403: {"error":{"message":"Provider returned error","code":403,"metadata":{"raw":"{\"code\":30001,\"message\":\"Sorry, your account balance is insufficient\",\"data\":null}","provider_name":"SiliconFlow","is_byok":false}},"user_id":"[hidden]"} |
| hy3-preview | method-density | no |  | 506ms | 0 | no | no | 0 |  |  | HTTP 403: {"error":{"message":"Provider returned error","code":403,"metadata":{"raw":"{\"code\":30001,\"message\":\"Sorry, your account balance is insufficient\",\"data\":null}","provider_name":"SiliconFlow","is_byok":false}},"user_id":"[hidden]"} |
