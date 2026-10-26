词潮 · CET6 词库文件（含音标）

文件说明
- cet6.json                      5,651 条源数据，无音标
- cet6-unique.json               3,992 个唯一词，无音标
- cet6-phonetic.csv              3,992 条 word,phonetic，用于「音标回填」
- cet6-with-phonetic.csv         3,992 条 word,phonetic,definition，可直接导入
- cet6-unique-with-phonetic.json 3,992 个唯一词，已带音标
- cet6-with-phonetic.json        5,651 条完整数据，已带音标
- LICENSE-KyleBing.txt          KyleBing/english-vocabulary 许可证
- LICENSE-IPA-Dict.txt          open-dict-data/ipa-dict 许可证 (MIT)

手机导入
1. 打开 https://menina323.github.io/word-drill/
2. 如果只要补音标：导入词库 → 音标回填 → 选择 cet6-phonetic.csv
3. 如果重新导入完整数据：导入词库 → CSV/JSON → 选择带 phonetic 的文件
4. 或者直接使用应用内「导入 CET6 词库」

音标来源
- open-dict-data/ipa-dict: https://github.com/open-dict-data/ipa-dict (MIT)
- 少数词典未收录词使用人工 IPA 回填
- 词库来源：https://github.com/KyleBing/english-vocabulary (BSD-3-Clause)
