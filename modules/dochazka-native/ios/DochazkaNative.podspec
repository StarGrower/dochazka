Pod::Spec.new do |s|
  s.name           = 'DochazkaNative'
  s.version        = '1.0.0'
  s.summary        = 'Docházka - záloha, místní upozornění, stav zařízení'
  s.description    = 'Šifrovaná záloha do složky v Souborech (CryptoKit + Klíčenka), místní upozornění s akcemi, stav podpisu appky.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  # Swift 5.9 jako expo-file-system - bez přísné kontroly souběhu ze Swiftu 6.
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
