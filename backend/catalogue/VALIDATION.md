# 岗位来源核验与数量缺口

核验日期：2026-10-26（Asia/Shanghai）。40 个当前可投岗位的结构及配额自动验收已通过；来源内容仍应随投递截止时间滚动复核。

## 当前目录

`jobs.v1.json` 有 50 条真实来源记录：40 条当前可投记录和 10 条待核验记录。40 条正式候选覆盖十个专业大类，每类 4 条；最低学历本科 27 条、硕士及以上 13 条。高校页面的日期统一标为转载日期，不当作企业最初发布时间。正文仅整理岗位职责、任职要求和共同招聘条件，不包含公司宣传或来源网站的行为指令。

**当前 open 40 条、unverified 10 条。** open 记录均有来源页面明示的未来有效期；仍未实际提交简历、发送邮件或联系招聘者。默认 `GET /api/jobs` 可查询这 40 条 open 记录；通过 `application_status=unverified` 可读取待核验记录，但未核验岗位不能创建匹配任务。独立前端示例均为虚构，不能提升真实岗位数量。

本轮新增来源主要为四川大学就业指导中心岗位详情页，页面在 2026-10-26 仍可被公开检索，明示的有效期均晚于核验日期。每条的具体依据及有效期已写入 `verification_note`。严格脚本输出为 open=40、十类各4条、硕博=13、本科=27、target_met=true。

| 岗位 ID | 核验结果 |
|---|---|
|bii-2027-software|[华北电力大学来源](https://job.ncepu.edu.cn/zpgg/89922b24888442c69d403bd06cc46c81.htm)同时出现已过期标记与未来截止日期，存在矛盾，未判为 open。|
|cgc-2027-welding|[天津工业大学来源](https://jobs.tiangong.edu.cn/correcruit/content/id/55328.html)有完整岗位和投递入口，无明确截止日期；当前投递状态待核验。|
|cgc-2027-civil|[天津工业大学来源](https://jobs.tiangong.edu.cn/correcruit/content/id/55326.html)有完整岗位和投递入口；不能把页面概述的北京当作实际海外工作地。|
|keymed-2027-oligonucleotide|[南开大学来源](https://career.nankai.edu.cn/correcruit/content/id/118200.html)表格列明硕士、专业和职责；网申当前岗位状态待核验。|
|keymed-2027-aidd-biology|同一南开来源中的独立博士岗位；按实际要求保留计算机等专业，不假设生物专业都可投。|
|taikang-2027-equity-research|[南开大学来源](https://career.nankai.edu.cn/correcruit/content/id/118486.html)写明 2026-11-30 截止，但本次无法读取短链接投递入口，暂不判为 open。|
|orient-2027-legal|[河北工业大学来源](https://career.hebut.edu.cn/home/correcruit/content/id/67117.html)正文可读，当前登录后的投递状态待核验。|
|cgc-2027-french|[天津工业大学来源](https://jobs.tiangong.edu.cn/correcruit/content/id/55331.html)正文可读，当前投递状态待核验；保存法语专四、英语四级及驻外要求。|
|orient-2027-design|[河北工业大学来源](https://career.hebut.edu.cn/home/correcruit/content/id/67115.html)正文可读，当前登录后的投递状态待核验。|
|lvao-2026-agronomist|[河南农业大学来源](https://henau.goworkla.cn/module/position_details/id-474182/nid-8086)明确标记校招，但未限定 2027 届；保留出差、驾驶及不收实习生要求，投递状态待核验。|

来源探索还发现：部分高校岗位详情页仅返回 Vue 模板占位符；搜索摘要不能补成完整 JD。命令行公开页面读取先遇到套接字权限限制，获准网络访问后目标站返回 HTTP 403，已停止该方式；可读内容通过公开检索工具核对，未尝试绕过登录或反爬限制。

## 用户提供的 BOSS 数据

只读审计十个城市的 `jobs_*.json`，并检查对应 CSV 表头；没有修改原文件。审计输出见 `boss_audit.v1.json`，可复跑 `backend/scripts/audit_boss_jobs.py`。

- 共 22,167 条城市记录，按岗位 ID 去重共 15,413 个岗位；2,221 条记录具有非空 jobDescription。
- 5,271 条记录明确标记“在校/应届”或“应届生”，其中 714 条有 JD；其中 452 条同时要求硕士或博士。条数可能跨城市重复，审计 JSON 另列去重数量。
- JSON 岗位记录及 CSV 表头均没有发布日期；不能把文件修改时间、头像日期或采集时状态冒充发布日期、当前投递状态。
- 这批数据可用于职业名称、技能词表、城市分布探索及待补核线索；补齐发布日期和来源、核验当前可投状态、复核 JD 完整性后才可进入正式候选目录。泛信管样本不能替代其他专业大类的采集。
- 审计只保存聚合数字，不复制原始 JD、招聘者姓名、头像、个人标识、访问标识或坐标，未将用户原始数据放入仓库。

## 剩余验收

当前静态目录已经满足首批岗位数量和类别、学历配额。10 条 unverified 来源记录仍不计入40条正式候选；岗位到达截止日期或来源状态变化后，应重新核验并调整状态。

后续需取得可读取的官方岗位详情与有效投递状态，逐条更新 verification_note、verified_at、application_status；来源不足的类别继续补充完整记录。运行：

```powershell
.\.venv\Scripts\python.exe backend/scripts/check_job_catalogue.py --as-of 2026-10-26 --require-target
```

验收脚本对结构错误、重复 ID、未来日期报错；数量检查要求 open≥40、十类各≥4、硕博≥12、本科≥20。2026-10-26 实际运行结果为 structural_validation=passed、open=40、target_met=true。
