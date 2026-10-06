export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // API sağlık kontrolü
    if (url.pathname === "/api/status") {
      return Response.json(
        {
          success: true,
          app: "Voxa",
          status: "online",
          timestamp: new Date().toISOString()
        },
        { headers: corsHeaders }
      );
    }

    // Basit arkadaş isteği API'si
    if (url.pathname === "/api/friend" && request.method === "POST") {
      try {
        const data = await request.json();

        if (!data.username) {
          return Response.json(
            {
              success: false,
              error: "Kullanıcı adı gerekli."
            },
            { status: 400, headers: corsHeaders }
          );
        }

        return Response.json(
          {
            success: true,
            message: "Arkadaşlık isteği gönderildi.",
            username: data.username
          },
          { headers: corsHeaders }
        );

      } catch {
        return Response.json(
          {
            success: false,
            error: "Geçersiz JSON verisi."
          },
          { status: 400, headers: corsHeaders }
        );
      }
    }

    // Ana endpoint
    if (url.pathname === "/api") {
      return Response.json(
        {
          name: "Voxa API",
          version: "1.0.0",
          status: "online"
        },
        { headers: corsHeaders }
      );
    }

    // Ana sayfa
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(
        `<!DOCTYPE html>
        <html lang="tr">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>Voxa API</title>
          <style>
            body{
              margin:0;
              min-height:100vh;
              display:flex;
              align-items:center;
              justify-content:center;
              background:#090b12;
              color:white;
              font-family:Arial,sans-serif;
            }
            .box{
              padding:35px;
              border-radius:22px;
              background:#151925;
              border:1px solid #292f40;
              text-align:center;
              box-shadow:0 20px 70px #0008;
            }
            h1{
              margin:0 0 10px;
              font-size:32px;
            }
            p{
              color:#8991a6;
            }
            .online{
              display:inline-block;
              margin-top:15px;
              padding:9px 14px;
              border-radius:12px;
              background:#173a2b;
              color:#5cffad;
            }
          </style>
        </head>
        <body>
          <div class="box">
            <h1>Voxa</h1>
            <p>Voxa Worker başarıyla çalışıyor.</p>
            <span class="online">● API ONLINE</span>
          </div>
        </body>
        </html>`,
        {
          headers: {
            "Content-Type": "text/html; charset=UTF-8"
          }
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: "Endpoint bulunamadı."
      }),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      }
    );
  }
};
