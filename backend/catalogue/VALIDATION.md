# 岗位来源核验与数量缺口

质量复核日期：2026-10-27（Asia/Shanghai）。此前声称 40 岗已通过验收有误：数量检查没有发现被截短的 JD，也没有核对来源岗位是否被错误拆分。本次复核后目标未达成。

## 当前目录

`jobs.v1.json` 有 80 条记录，目前 11 条 `open`、69 条 `unverified`。11 条中最低学历本科 10 条、硕士 1 条；可投类别和学历配额仍未达标。高校页面的日期标为转载日期，不当作企业最初发布时间。

**当前 open 11 条、unverified 69 条。** 默认 `GET /api/jobs` 只查询 open 记录；`GET /api/jobs/testing-pool` 返回 40 条多专业测试岗位，其中 29 条仍为 unverified。调用匹配接口时须显式传 `allow_unverified_for_testing=true`，且仅对测试池中的待核验岗位放宽限制。测试匹配不提升可投状态。没有实际提交简历、发送邮件或联系招聘者，也没有验证登录后最终能否投递。独立前端示例均为虚构，不能提升真实岗位数量。

2026-10-27 为测试池新增 24 条来源可核对的岗位正文：涵盖[中车南京浦镇 2027 校招](https://career.nankai.edu.cn/correcruit/content/id/118737.html)、[保利海南独立岗位](https://career.nankai.edu.cn/correcruit/content/id/116870.html)、[东风研发总院简章](https://career.nankai.edu.cn/correcruit/content/id/116880.html)、[世和基因独立岗位](https://career.nankai.edu.cn/correcruit/content/id/119462.html)、[四达时代简章](https://career.nankai.edu.cn/correcruit/content/id/118402.html)、[苏仁智能简章](https://career.nankai.edu.cn/correcruit/content/id/118732.html)及其他页面。JD 为对原岗位职责与资格的忠实转述，页面发布日期按高校转载日记录；每条保留来源 URL 和核验说明。未确认当前可投和最终投递入口，因此均标 unverified，`application_url=null`。原有 41 条把来源 URL 重复填作投递 URL 的 unverified 记录也已置空该字段，避免误导前端。

测试池最低结构门槛是 JD 至少 80 字，并同时含“岗位职责”“任职要求”；40 条按十类各 4 条，最低学历硕士/博士 12 条、本科 28 条。结构与来源可追溯性可以支持多专业匹配测试；它不证明岗位仍在招聘，也不替代逐条可投核验。

2026-10-27 新增中兴新云官网 6 个独立岗位：[校招岗位列表](https://www.ztccloud.com.cn/careers/campus-jobs.html)注明 2027 届、岗位信息更新于 2026-09-29、网申截止 2026-12-31；每个岗位详情页列出完整职责及任职资格。单独的[公开网申表](https://www.wenjuan.com/s/UZBZJvhceK/)可打开，并明确列出这 6 个岗位供选择。目录中 `source_url` 指向企业官网各岗位详情，`application_url` 指向网申表；未提交表单或验证提交后的审核流程。6 个岗位按实际工作方向计入计算机 2 条、经管财会 4 条，不冒充其他类别。

本次复核发现原 40 条 open 中 29 条 JD 不足 60 字，另有 3 条虽更长但缺少可核对的完整岗位职责或仍需逐项复核，再有 3 条把来源页误写为直接投递链接，合计 35 条退出候选集。尤其是 `saic-2027-industrial-design` 将[来源的“研发储备生”](https://jy.scu.edu.cn/index/index/employjobdetail.html?data=MDAwMDAwMDAwMJG6n3_Ed6imi4qQtLh5eZiKz7bOs4bddricp9CWi5qikaeWacSdqLqGfaK2w4iil5C4zNbGiL-E)错误拆成工业设计独立岗位；`cscec4dev-2027-overseas` 将[“现场工程师”来源](https://jy.scu.edu.cn/index/index/employjobdetail.html?data=MDAwMDAwMDAwMJG6n3_Ed6imi4qQtLh4Y9yKlLbSsnbddricp9CWi5qikaeWacSdqLqGfaK2w4iil5C4zNbGiL-E)的地区和总体专业信息误当成独立驻外岗位。两条已更正展示字段并标为待核验，不计入配额。来源未限定毕业届别的已核实记录同步更正届别字段。其余 unverified 仍是待复核线索，不能据其摘要推断申请资格。

验收脚本现要求每条 open 的 JD 至少 80 字，并明确包含岗位职责、任职要求两部分；这只是最低结构门槛，来源真实性和投递入口仍需人工核对。当前输出为 records=80、testing_pool=40、testing_target_met=true、open=11、unverified=69、target_met=false。

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

当前静态目录距 40 条可投岗位还缺 29 条；十类及学历配额缺口见验收脚本输出。逐条核对来源职位名称及毕业届别、复核投递入口后，才能将对应记录改回 open。岗位到达截止日期或来源状态变化后也需重新核验。

后续需取得可读取的官方岗位详情与有效投递状态，逐条更新 verification_note、verified_at、application_status；来源不足的类别继续补充完整记录。运行：

```powershell
.\.venv\Scripts\python.exe backend/scripts/check_job_catalogue.py --as-of 2026-10-27 --require-target
.\.venv\Scripts\python.exe backend/scripts/check_job_catalogue.py --as-of 2026-10-27 --require-testing-pool
```

验收脚本对结构错误、重复 ID、未来日期、open JD 缺少职责或要求报错；数量检查分别报告测试池与可投岗位。2026-10-27 复核结果为 structural_validation=passed、testing_target_met=true、open=11、target_met=false；`--require-target` 因可投数量及配额缺口返回非零，符合预期。
