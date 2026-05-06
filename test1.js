// import { generateImagePrompts } from "./generateImagePrompt.js";

import { generateImage } from "./generateImage.js";
import { generateStoryAudio } from "./generateStoryAudio.js";
import { generateStoryDialogs } from "./generateStoryDialogs.js";

// const input = [
//   { start: 0, end: 2080, text: "एक लड़का दोस्त के घर गया।" },
//   { start: 2180, end: 4260, text: "दोस्त ने पूछा, खाना खाएगा?" },
//   { start: 4360, end: 6600, text: "लड़का बोला, नहीं-नहीं।" },
//   { start: 6700, end: 8780, text: "अभी घर से खाकर आया हूँ।" },
//   { start: 8880, end: 11120, text: "तभी समोसे की खुशबू आई।" },
//   { start: 11220, end: 13300, text: "दोस्त बोला, सच बता।" },
//   { start: 13400, end: 14360, text: "खाएगा क्या?" },
//   { start: 14460, end: 16700, text: "लड़का बोला, खाना नहीं खाऊंगा।" },
//   { start: 16800, end: 18720, text: "बस समोसे से दोस्ती करवा दे।" },
// ];

// generateImagePrompts(input).then((prompts) => console.log(prompts));

// generateImage(
//   `The climax of the story, showing the visiting boy's final, clever compromise. The 12-year-old boy with a round face, expressive dark brown eyes, short black hair, and light blue kurta is now smiling broadly, his earlier resistance completely melted away. He holds up his hands in a gesture of friendship, asking not for a full meal, but just to 'make friends with the samosas' - a humorous and endearing way of asking for samosas without formally accepting a meal. The host boy bursts into laughter, his chubby face glowing with delight, his white vest shaking with his laughter. Between them on the small wooden table, a plate of golden, crispy samosas has appeared, steam still rising from them, along with a small bowl of green chutney. The warm yellow walls, wooden charpai, ceiling fan, and green-curtained window complete the familiar setting. The lighting is at its warmest, celebrating the victory of friendship and samosas alike. The mood is joyful, triumphant, and deeply satisfying, capturing the essence of childhood humor, friendship, and the irresistible bond between a person and a perfectly fried samosa`,
//   `output/test.png`,
// )
//   .then(() => console.log("Image generated successfully"))
//   .catch((error) => console.error("Error generating image:", error));


  // const result = await generateStoryAudio({
  //   storySentences: [
  //     'एक गांव जंगल के पास था।',
  //     'लोग लकड़ी काटकर शहर में बेचते थे।',
  //     'जंगल में जंगली जानवरों का खतरा था।',
  //   ],
  //   referenceAudioPath: '/media/hyper2/HYPER8/yt/reels/reel1/audio.mp3',
  //   referenceTranscript: 'एक बहुत कंजूस आदमी के घर अचानक कई मेहमान आ गए। अब कंजूस सोच में पड़ गया कि यह लोग तो एक ही दिन में मेरे पूरे महीने का राशन साफ कर देंगे',
  //   outputDir: 'output/story_audio',
  // });


  generateStoryDialogs(`दोस्तो, हमारी आज की कहानी अपने आप मे ही खास है । जब भी हम कुछ नया करने का सोचते है तो हमे एक guidance चाहिए होती है । जिसके लिए हमे एक गुरु की जुरुरत पड़ती है । हमारी ज़िंदगी मे गुरु का बहुत बड़ा स्थान होता है । आइए इस बात को एक कहानी के दुबारा समझते है …..
एक राजा था , जिसका बहुत बड़ा राज्य (Kingdom) था । उस राजे को पढ़ने और लिखने का बहुत शौक(Hobby) था। राजे ने सभी मंत्रियों(Ministers) को बुलाया और कहा कि मेरे लिए एक  गुरु की व्यवस्था की जाए जो इस राज्य मे सबसे ज्यादा  शिक्षक हो ।
मंत्रियों की परिषद ने राजे के लिए एक शिक्षक की व्यवस्था की। शिक्षक अब राजा को सिखाने के लिए रोज उसके महल आता। राजा शिक्षक को गुरु जी कहकर बुलाता जैसे परंपरा होती।
राजा दिल लगा कर पढता रहा । ऐसा कई महीनो तक चलता रहा । राजा दिल लगाकर पढ रहा था पर उसको कुछ भी समझ नही आ रहा था । यह बात उसने अपने खास – मंत्री को बोली कि बात ऐसी है तो मुझे इस का कारण(Reason) बताओ ।
मंत्री बोला राजा जी यह बात तो मेरी समझ से भी बाहर है , जब आप दिल लगा कर पढ़ रहे हो तो समझ मे आना चाहिये। काफी सोचने के बाद मंत्री ने कहा – राजा जी आप यह बात खुद गुरु जी से पूछिए। राजा को मंत्री की यह बात सही लगी ।
अगले दिन जब गुरु जी राजा को सिक्षा देने लगे तो राजा को देख कर बोले – आप कुछ प्रेसान लग रहे हो । राजा ने सारी बात बताई कि मै दिल लगा कर पढ़ता हु फिर भी मुझे कुछ समझ नही आता ।
तब गुरु जी बोले राजन बात बहुत सीधी है । आप राजा हो हम से ऊचे स्थान(Higher Position) पर बैठते हो। आप राजा हो यह सही है । परंतु एक गुरु का स्थान सब से उचा होता है । आपके मन मे कही न कही इस बात का मान है कि आप हम से ऊचे और दूसरा जब भी आप सिक्षा लेते हो खुद सिहासन पर बैठते हो जब कि हम आप के नीचे बैठते है । गुरु का स्थान(Place of guru) हमेशा अपने राजन से ऊपर होता है ।`)
  .then(console.log)
  .catch(console.error)