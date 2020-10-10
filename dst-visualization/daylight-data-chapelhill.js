var wakingMinutesInDarkNoDST = 18760;
var sleepingMinutesInLightNoDST = 1285;

var sunrise = new Array();
sunrise.push(447,447,447,447,447,447,447,447,447,447,447,447,446,446,446,446,445,445,445,444,444,443,443,442,442,441,440,440,439,438,438,437,436,435,434,433,432,432,431,430,429,428,427,426,425,423,422,421,420,419,418,417,415,414,413,412,410,409,408,406,405,404,402,401,400,398,397,396,394,393,391,390,389,387,386,384,383,381,380,379,377,376,374,373,371,370,368,367,366,364,363,361,360,358,357,356,354,353,351,350,349,347,346,345,343,342,341,339,338,337,336,334,333,332,331,330,328,327,326,325,324,323,322,321,320,319,318,317,316,315,314,313,312,311,311,310,309,308,308,307,306,306,305,305,304,304,303,303,302,302,301,301,301,300,300,300,300,300,299,299,299,299,299,299,299,299,299,299,299,300,300,300,300,300,301,301,301,302,302,302,303,303,304,304,305,305,306,306,307,307,308,309,309,310,311,311,312,313,313,314,315,315,316,317,318,318,319,320,321,321,322,323,324,324,325,326,327,328,328,329,330,331,332,332,333,334,335,336,336,337,338,339,339,340,341,342,343,343,344,345,346,346,347,348,349,350,350,351,352,353,353,354,355,356,356,357,358,359,359,360,361,362,363,363,364,365,366,366,367,368,369,370,370,371,372,373,374,374,375,376,377,378,379,379,380,381,382,383,384,385,386,386,387,388,389,390,391,392,393,394,395,396,397,398,399,400,401,402,403,403,404,405,406,407,408,409,410,411,412,413,414,415,416,417,418,419,420,421,422,423,424,425,426,427,428,429,430,431,432,432,433,434,435,436,436,437,438,439,439,440,440,441,442,442,443,443,444,444,445,445,445,446,446,446,446);

var sunset = new Array();
sunset.push(1033,1034,1035,1036,1036,1037,1038,1039,1040,1041,1042,1043,1044,1045,1046,1047,1048,1049,1050,1051,1052,1053,1054,1055,1056,1057,1058,1059,1060,1061,1062,1063,1064,1065,1066,1068,1069,1070,1071,1072,1073,1074,1075,1076,1077,1078,1079,1080,1081,1082,1083,1084,1085,1086,1086,1087,1088,1089,1090,1091,1092,1093,1094,1095,1096,1097,1098,1098,1099,1100,1101,1102,1103,1104,1105,1105,1106,1107,1108,1109,1110,1110,1111,1112,1113,1114,1115,1115,1116,1117,1118,1119,1120,1121,1121,1122,1123,1124,1125,1126,1126,1127,1128,1129,1130,1131,1131,1132,1133,1134,1135,1136,1136,1137,1138,1139,1140,1141,1142,1142,1143,1144,1145,1146,1147,1147,1148,1149,1150,1151,1152,1152,1153,1154,1155,1156,1156,1157,1158,1159,1160,1160,1161,1162,1163,1163,1164,1165,1165,1166,1167,1167,1168,1169,1169,1170,1170,1171,1171,1172,1172,1173,1173,1174,1174,1174,1175,1175,1175,1176,1176,1176,1176,1176,1176,1177,1177,1177,1177,1177,1177,1177,1177,1176,1176,1176,1176,1176,1175,1175,1175,1175,1174,1174,1173,1173,1172,1172,1171,1171,1170,1169,1169,1168,1167,1167,1166,1165,1164,1164,1163,1162,1161,1160,1159,1158,1157,1156,1155,1154,1153,1152,1151,1150,1148,1147,1146,1145,1144,1142,1141,1140,1139,1137,1136,1135,1133,1132,1131,1129,1128,1127,1125,1124,1122,1121,1120,1118,1117,1115,1114,1112,1111,1109,1108,1106,1105,1103,1102,1101,1099,1098,1096,1095,1093,1092,1090,1089,1087,1086,1084,1083,1081,1080,1079,1077,1076,1074,1073,1071,1070,1069,1067,1066,1065,1063,1062,1061,1059,1058,1057,1055,1054,1053,1052,1051,1049,1048,1047,1046,1045,1044,1043,1042,1041,1040,1039,1038,1037,1036,1035,1034,1033,1032,1032,1031,1030,1029,1029,1028,1028,1027,1026,1026,1025,1025,1025,1024,1024,1023,1023,1023,1023,1022,1022,1022,1022,1022,1022,1022,1022,1022,1022,1022,1022,1023,1023,1023,1023,1024,1024,1025,1025,1025,1026,1026,1027,1028,1028,1029,1029,1030,1031,1031,1032);

var daysInMonth = new Array();
daysInMonth.push(31,28,31,30,31,30,31,31,30,31,30,31);

var monthNames = new Array();
monthNames.push("ZERO", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec");
