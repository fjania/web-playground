function startNewTable(dt){
    dt.addColumn('string', 'text');
    dt.addColumn('number', 'frequency');
    dt.addColumn('string', 'url');
    dt.addColumn('string', 'color');
}

function loadDataTables(){
    dts = {};

    dts['population'] = new google.visualization.DataTable();
    startNewTable(dts['population']);
    dts['population'].addRow(['Shanghai', 17.836, '', '#CCCCCC']);
    dts['population'].addRow(['Karachi', 12.991, '', '#CCCCCC']);
    dts['population'].addRow(['Istanbul', 12.946, '', '#CCCCCC']);
    dts['population'].addRow(['Mumbai', 12.478, '', '#CCCCCC']);
    dts['population'].addRow(['Beijing', 11.716, '', '#CCCCCC']);
    dts['population'].addRow(['Moscow', 11.551, '', '#CCCCCC']);
    dts['population'].addRow(['São Paulo',   11.316, '', '#CCCCCC']);
    dts['population'].addRow(['Tianjin', 11.090, '', '#CCCCCC']);
    dts['population'].addRow(['Guangzhou', 11.070, '', '#CCCCCC']);
    dts['population'].addRow(['Delhi', 11.007, '', '#CCCCCC']);
    dts['population'].addRow(['Seoul', 10.575, '', '#CCCCCC']);
    dts['population'].addRow(['Shenzhen', 10.357, '', '#CCCCCC']);
    dts['population'].addRow(['Jakarta', 9.588, '', '#CCCCCC']);
    dts['population'].addRow(['Tokyo', 8.887, '', '#CCCCCC']);
    dts['population'].addRow(['Mexico City', 8.873, '', '#CCCCCC']);
    dts['population'].addRow(['Kinshasa', 8.754, '', '#CCCCCC']);
    dts['population'].addRow(['Bangalore', 8.425, '', '#CCCCCC']);
    dts['population'].addRow(['Dongguan', 8.220, '', '#CCCCCC']);
    dts['population'].addRow(['New York City', 8.175, '', '#CCCCCC']);
    dts['population'].addRow(['Lagos', 7.937, '', '#CCCCCC']);
    dts['population'].addRow(['London', 7.753, '', '#CCCCCC']);
    dts['population'].addRow(['Lima', 7.605, '', '#CCCCCC']);
    dts['population'].addRow(['Bogotá', 7.467, '', '#CCCCCC']);
    dts['population'].addRow(['Tehran', 7.241, '', '#CCCCCC']);
    dts['population'].addRow(['Ho Chi Minh City', 7.162, '', '#CCCCCC']);
    dts['population'].addRow(['Hong Kong', 7.108, '', '#CCCCCC']);
    dts['population'].addRow(['Bangkok', 7.025, '', '#CCCCCC']);
    dts['population'].addRow(['Dhaka', 7.000, '', '#CCCCCC']);
    dts['population'].addRow(['Hyderabad', 6.809, '', '#CCCCCC']);
    dts['population'].addRow(['Cairo', 6.758, '', '#CCCCCC']);
    dts['population'].addRow(['Hanoi', 6.451, '', '#CCCCCC']);
    dts['population'].addRow(['Wuhan', 6.434, '', '#CCCCCC']);
    dts['population'].addRow(['Rio de Janeiro', 6.323, '', '#CCCCCC']);
    dts['population'].addRow(['Lahore', 6.318, '', '#CCCCCC']);
    dts['population'].addRow(['Ahmedabad', 5.570, '', '#CCCCCC']);
    dts['population'].addRow(['Baghdad', 5.402, '', '#CCCCCC']);
    dts['population'].addRow(['Riyadh', 5.188, '', '#CCCCCC']);
    dts['population'].addRow(['Singapore', 5.183, '', '#CCCCCC']);
    dts['population'].addRow(['Santiago', 5.012, '', '#CCCCCC']);
    dts['population'].addRow(['Saint Petersburg', 4.868, '', '#CCCCCC']);
    dts['population'].addRow(['Chennai', 4.681, '', '#CCCCCC']);
    dts['population'].addRow(['Chongqing', 4.513, '', '#CCCCCC']);
    dts['population'].addRow(['Kolkata', 4.486, '', '#CCCCCC']);
    dts['population'].addRow(['Surat', 4.462, '', '#CCCCCC']);
    dts['population'].addRow(['Yangon', 4.350, '', '#CCCCCC']);
    dts['population'].addRow(['Ankara', 4.223, '', '#CCCCCC']);
    dts['population'].addRow(['Alexandria', 4.110, '', '#CCCCCC']);
    dts['population'].addRow(['Shenyang', 4.101, '', '#CCCCCC']);
    dts['population'].addRow(['New Taipei City', 3.910, '', '#CCCCCC']);
    dts['population'].addRow(['Johannesburg', 3.888, '', '#CCCCCC']);
    dts['population'].addRow(['Los Angeles', 3.792, '', '#CCCCCC']);
    dts['population'].addRow(['Yokohama', 3.680, '', '#CCCCCC']);
    dts['population'].addRow(['Abidjan', 3.660, '', '#CCCCCC']);
    dts['population'].addRow(['Busan', 3.600, '', '#CCCCCC']);
    dts['population'].addRow(['Cape Town', 3.497, '', '#CCCCCC']);
    dts['population'].addRow(['Durban', 3.468, '', '#CCCCCC']);
    dts['population'].addRow(['Jeddah', 3.430, '', '#CCCCCC']);
    dts['population'].addRow(['Berlin', 3.424, '', '#CCCCCC']);
    dts['population'].addRow(['Pyongyang', 3.255, '', '#CCCCCC']);
    dts['population'].addRow(['Madrid', 3.213, '', '#CCCCCC']);
    dts['population'].addRow(['Nairobi', 3.138, '', '#CCCCCC']);
    dts['population'].addRow(['Pune', 3.115, '', '#CCCCCC']);
    dts['population'].addRow(['Jaipur', 3.073, '', '#CCCCCC']);
    dts['population'].addRow(['Casablanca', 3.027, '', '#CCCCCC']);

    dts['populationdensity'] = new google.visualization.DataTable();
    startNewTable(dts['populationdensity']);
    dts['populationdensity'].addRow(['Manila', 111.576 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Bogor', 104.037 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Titagarh', 99.293 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Baranagar', 91.220 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Serampore', 87.151 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Pateros', 76.392 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Delhi', 75.512 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['South Dumdum', 75.069 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Kamarhati', 74.323 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Kolkata', 71.935 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Ahmedabad', 70.693 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Mandaluyong', 70.288 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Levallois-Perret', 67.984 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Neapoli', 67.027 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Caloocan', 66.952 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Chennai', 66.047 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Vincennes', 64.540 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Sukabumi', 64.099 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Saint-Mandé', 64.048 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Le Pré-Saint-Gervais', 63.867 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Saint-Josse-ten-Noode', 60.179 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Malabon', 59.767 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Mumbai', 59.406 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Jaigaon', 59.293 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Navotas', 59.001 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Montrouge', 58.217 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Banupur', 58.011 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Bally', 57.218 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Balurghat', 55.190 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Mislata', 54.695 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Pasay', 54.944 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Kallithea', 54.733 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Paris', 53.883 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['San Juan', 54.230 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Nea Smyrni', 53.717 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Pasig', 51.575 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Howrah', 51.779 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Dhaka', 50.368 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Union City', 3.29 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Macau', 48.490 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Makati', 48.315 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Naihati', 48.280 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Saint-Gilles', 48.234 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Cairo', 46.804 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Allahabad', 46.697 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Panihati', 46.519 , '', '#CCCCCC']);
    dts['populationdensity'].addRow(['Malé', 46.320 , '', '#CCCCCC']);

    dts['gdp'] = new google.visualization.DataTable();
    startNewTable(dts['gdp']);
    dts['gdp'].addRow(['Tokyo', 1479 , '', '#CCCCCC']);
    dts['gdp'].addRow(['New York City', 1406 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Los Angeles', 792 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Chicago', 574 , '', '#CCCCCC']);
    dts['gdp'].addRow(['London', 565 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Paris', 564 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Osaka/Kobe', 417 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Mexico City', 390 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Philadelphia', 398 , '', '#CCCCCC']);
    dts['gdp'].addRow(['São Paulo', 388 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Washington D.C.', 375 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Boston', 363 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Buenos Aires', 362 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Dallas', 338 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Moscow', 321 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Hong Kong', 320 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Atlanta', 304 , '', '#CCCCCC']);
    dts['gdp'].addRow(['San Francisco', 301 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Houston', 297 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Miami', 292 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Seoul', 291 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Toronto', 253 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Detroit', 253 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Seattle', 235 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Shanghai', 233 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Madrid', 230 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Singapore', 215 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Sydney', 213 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Mumbai', 209 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Rio de Janeiro', 201 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Phoenix', 200 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Minneapolis', 194 , '', '#CCCCCC']);
    dts['gdp'].addRow(['San Diego', 191 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Istanbul', 182 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Barcelona', 177 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Melbourne', 172 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Delhi', 167 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Beijing', 166 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Denver', 165 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Metro Manila', 149 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Montreal', 148 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Cairo', 145 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Rome', 144 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Guangzhou', 143 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Baltimore', 137 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Milan', 136 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Tehran', 127 , '', '#CCCCCC']);
    dts['gdp'].addRow(['St. Louis', 126 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Tampa', 123 , '', '#CCCCCC']);
    dts['gdp'].addRow(['Vienna', 122 , '', '#CCCCCC']);

    return dts;
}

