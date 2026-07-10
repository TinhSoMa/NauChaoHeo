Getting started
Introduction
Welcome to Zalo AI Platform. We are pleased to introduce a set of AI APIs that we have been using in production internally at Zalo. We hope that AI developers will try out these APIs and integrate them to solve your own applications.

Get API Key
apikey is your authentication token to access APIs.

Step 1: Log in  with your Zalo account
Step 2: Navigate to your “My Keys”  . Your apikey will be listed bellow
How to call API
API host: 
Required header:
apikey: authentication token to access APIs
To call with apikey: add apikey tag to the header portion of your request
curl -H "apikey: your_api_key_here" -X POST "https://api.zalo.ai/{{target_api_url}}"

Text to Audio Converter
Introduction
Zalo Text-To-Speech (ZTTS) engine delivers fast and premium quality audios from input Vietnamese text. ZTTS is optimized for realtime and high volume traffic applications such as news websites, voice streaming services, chatbots, and virtual assistants. ZTTS currently supports four Vietnamese voices including two Northern accents and two Southern accents.

How to call API
API url
POST  https://api.zalo.ai/v1/tts/synthesize
Required  header
apikey: authentication token to access APIs, 
Post data
input: text content to synthesize.
speed: Optional, float value inside range [0.8, 1.2], larger is faster, default 1.0.
quality: Available for paid user only, quality of generated speech
Value encode	Description
0	Default value, standard quality,
1	High quality
encode_type: Optional,  standard encoding for audio files 
Value encode	Description
0	WAV
1	MP3
2	AAC
speaker_id: Optional, ID of speaker, default 1. List of speaker:
ID	Name
1	South women 1
2	Northern women 1
3	South men
4	Northern men
5	Northern women 2
6	South women 2
Example request
curl \
  -H "apikey: your_api_key_here" \
  --data-urlencode "input=Chứng khoán châu Á đỏ lửa" \
  -X POST https://api.zalo.ai/<version>/tts/synthesize
curl \
  -H "apikey: your_api_key_here" \
  --data-urlencode "input=Rất nhiều khách hàng hỏi chúng tôi vì sao đôla Mỹ lại mất giá." \
  -d "speaker_id=3" \
  -X POST https://api.zalo.ai/<version>/tts/synthesize
curl \
  -H "apikey: your_api_key_here" \
  --data-urlencode "input=Chơi game gì? Coi phim gì? Đi chơi chỗ nào?" \
  -d "speaker_id=4" \
  -d "speed=0.8" \
  -X POST https://api.zalo.ai/<version>/tts/synthesize
Example response
Successful response with http error_code  0
{
   "error_code":0,
   "error_message":"Successful.",
   "data":{
      "url":"https://chunk.lab.zalo.ai/bb49d943a114484a1105/bb49d943a114484a1105"
   }
}
url: generated streaming url
Error response
Error response with http error_code other than 0
{
    "error_code": 500,
    "error_message": "Internal server error",
    "data": []
}
List of error_code
error_code	error_message
0	Success
150	Invalid parameter value
155	Your input exceeds the allowed limit of 2000 characters
400	Wrong request parameter
401	Wrong apikey
413	Error occurred
500	Internal server error

TTS Silence Syntax
Introduction
Zalo Text-To-Speech (ZTTS) engine can produce high-quality and natural speech. But in some scenarios, users may want to add custom pauses, like in storytelling, noticing, … ZTTS now support you to do that in Web interface or API calls.

How to use
Common rules for input text
Silence utterance by following syntax: <<<sil#{number_milisecond}>>>

number_milisecond: A positive integer number within the range of 100 to 20000 that determines the duration of silence duration, in milliseconds. 
number_milisecond will be rounded up. For example: 110 will be 100,  150 will be 200,  10001 will be 10000, 9990 will be 10000 and so on.
Before and after of silence syntax need to be a space character, otherwise it will not work:

Work example:
This is <<<sil#1000>>> 1 second silence
NOT work example:
This is<<<sil#1000>>> 1 second silence
This is <<<sil#1000>>>1 second silence
This is<<<sil#1000>>>1 second silence
Silence utterance should not be inserted in a word or phrase, otherwise it will generate unexpected utterances. For example:

Normal: tuoitre.com

*speak “tuổi trẻ chấm cơm”


Wrong: tuoi <<<sil#1000>>> tre.com

*speak “Tuổi tê rờ e chấm cơm”


 

In case of wrong syntax
In case of wrong syntax, generating silence utterances will be awkward. For examples:

Trailing after or before by a nonspace character: <<<sil#1000>>>-
* This phrase above will be read as vietnamese like this “Bé hơn bé hơn bé hơn ét i lờ thăng một không không không lớn hơn lớn hơn lớn hơn”
{number_milisecond} is negative number: <<<sil#-1000>>>
*speak “Bé hơn bé hơn bé hơn ét i lờ thăng một không không không lớn hơn lớn hơn lớn hơn”
{number_milisecond} is empty: <<<sil#>>>
*speak “Bé hơn bé hơn bé hơn ét i lờ thăng lớn hơn lớn hơn lớn hơn”
Some other wrong syntax examples:
abc<<<sil#1000>>>
<<<silnce#1000>>>
<<<si#1000>>>
<<sil#1000>>
<<<sil@1000>>>
Example API calls
curl --location --request POST 'https://api.zalo.ai/v1/tts/synthesize' \
--header 'apikey: your_api_key_here' \
--header 'Content-Type: application/x-www-form-urlencoded' \
--data-urlencode 'input=TAND Hà Nội <<<sil#10000>>> đang tuyên án' \
--data-urlencode 'encode_type=0'