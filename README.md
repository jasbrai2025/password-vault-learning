# Password Vault (Learning Project)

एउटा सजिलो, सुरक्षित password vault — मोबाइल र computer दुवैको browser बाट चल्छ, र दुवैमा उही डाटा देखिन्छ किनभने डाटा एउटै server मा राखिन्छ।

## कसरी काम गर्छ

- **Register/Login**: Master password `bcrypt` ले hash गरी राखिन्छ (server ले कहिल्यै plain password store गर्दैन)।
- **Encryption**: प्रत्येक saved password `AES-256-GCM` ले encrypt गरिन्छ, key तपाईंको master password बाट निकालिन्छ।
- **Storage**: डाटा `data/db.json` फाइलमा बस्छ (कुनै database install गर्नुपर्दैन, कुनै Python/compiler पनि चाहिँदैन — जुनसुकै computer मा तुरुन्तै चल्छ)।
- **Sync**: तपाईं जुनसुकै device (मोबाइल वा computer) बाट browser खोलेर लगइन गर्दा उही server बाट डाटा आउँछ — त्यसैले automatically sync हुन्छ।

## Local मा चलाउने तरिका

1. Dependencies install गर्नुहोस्:
   ```
   npm install
   ```
2. `.env.example` लाई `.env` मा copy गर्नुहोस् र `JWT_SECRET` भर्नुहोस्:
   ```
   cp .env.example .env
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
   माथिको command ले दिएको random string लाई `.env` भित्र `JWT_SECRET=` पछि राख्नुहोस्।
3. Server चलाउनुहोस्:
   ```
   npm start
   ```
4. Browser मा `http://localhost:3000` खोल्नुहोस्।

## मोबाइल र computer दुवैमा sync गर्न (Deploy)

Local मा `localhost` मोबाइल बाट पुग्दैन। दुवै device बाट access गर्न, यो app लाई free hosting मा deploy गर्नुपर्छ (जस्तै Render.com, Railway.app, वा Fly.io) — त्यसपछि दुवै device ले उही live URL खोल्ने हो।

Render.com मा deploy गर्ने साधारण चरण:
1. यो GitHub repository लाई Render मा "New Web Service" को रूपमा connect गर्नुहोस्।
2. Build command: `npm install`
3. Start command: `npm start`
4. Environment variable मा `JWT_SECRET` थप्नुहोस् (माथि जस्तै random string)।
5. Deploy भएपछि दिइएको URL मोबाइल र computer दुवैको browser मा खोल्नुहोस्।

## Security Notes

- `.env` फाइल कहिल्यै GitHub मा नराख्नुहोस् (`.gitignore` ले पहिले नै exclude गरेको छ)।
- Master password बिर्सनुभयो भने vault भित्रको data फिर्ता ल्याउन सकिँदैन (encryption key त्यही password बाट आउँछ)।
- यो learning project हो — production मा वास्तविक महत्त्वपूर्ण passwords राख्नुअघि थप security review गर्नुहोस्।
