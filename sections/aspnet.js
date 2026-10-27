window.PREP = window.PREP || [];
window.PREP.push({
  id: 'aspnet',
  title: 'ASP.NET Core',
  chapters: [

    { id: 'hosting', title: 'Хостинг и запуск', html: `<h3>Generic Host и WebApplication</h3>
<p>Любое современное приложение на .NET — веб-API, воркер, консольный сервис, читающий Kafka, — запускается внутри <strong>хоста</strong>. Хост — это объект, который владеет всем общим для приложения: DI-контейнером, конфигурацией, логированием, временем жизни (<code>IHostApplicationLifetime</code>) и набором фоновых сервисов (<code>IHostedService</code>). Веб-сервер — это тоже просто один из hosted services: Kestrel запускается и останавливается хостом так же, как ваш <code>BackgroundService</code>.</p>
<p>Исторически было два хоста: <code>WebHost</code> (ASP.NET Core 1–2) и <strong>Generic Host</strong> (<code>Host.CreateDefaultBuilder</code>, с 3.0), который отделил «хостинг» от «веба». С .NET 6 появилась <strong>minimal hosting model</strong>: <code>WebApplication.CreateBuilder(args)</code>. Это не новый хост, а удобная обёртка над тем же Generic Host: <code>WebApplicationBuilder</code> собирает конфигурацию, сервисы и логирование, а <code>WebApplication</code> одновременно является и хостом (<code>IHost</code>), и построителем конвейера (<code>IApplicationBuilder</code>), и построителем маршрутов (<code>IEndpointRouteBuilder</code>). Отсюда и «плоский» <code>Program.cs</code> без класса <code>Startup</code>.</p>
<pre><code>var builder = WebApplication.CreateBuilder(args);

// 1. Регистрация сервисов — до Build()
builder.Services.AddControllers();
builder.Services.AddProblemDetails();
builder.Services.Configure&lt;KafkaOptions&gt;(builder.Configuration.GetSection("Kafka"));

var app = builder.Build();   // контейнер построен, после этого Services менять нельзя

// 2. Конвейер middleware и эндпоинты — после Build()
app.UseExceptionHandler();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();                   // блокирует поток до остановки хоста</code></pre>
<p>Для приложений без HTTP есть <code>Host.CreateApplicationBuilder(args)</code> (с .NET 7) — та же «плоская» модель, но без Kestrel и конвейера: идеально для consumer-сервиса Kafka. Для Native AOT существует <code>WebApplication.CreateSlimBuilder</code> с урезанным набором функций по умолчанию.</p>
<blockquote><strong>Важно.</strong> Граница <code>builder.Build()</code> — ключевая: до неё вы регистрируете сервисы, после — только используете. Попытка добавить сервис в <code>builder.Services</code> после <code>Build()</code> бросает исключение, потому что коллекция становится read-only.</blockquote>
<p>Что даёт <code>CreateBuilder</code> «из коробки»: корень контента (content root) — текущая директория; конфигурацию из <code>appsettings.json</code>, <code>appsettings.{Environment}.json</code>, user secrets (только в Development), переменных окружения и аргументов командной строки; логирование в консоль, Debug и EventSource (и EventLog на Windows); проверку DI-scopes в Development; Kestrel как веб-сервер; и интеграцию с IIS, если приложение под ним запущено.</p>

<h3>Kestrel и обратный прокси</h3>
<p><strong>Kestrel</strong> — кроссплатформенный HTTP-сервер, встроенный в ASP.NET Core. Он поддерживает HTTP/1.1, HTTP/2 и HTTP/3 (последний — через QUIC, с ограничениями по платформам), TLS, Unix sockets. Kestrel давно достаточно зрелый, чтобы смотреть в интернет напрямую, но в продакшене его почти всегда ставят за <strong>reverse proxy</strong> или ingress (nginx, Envoy, Kubernetes Ingress, YARP): там терминируется TLS, живут сертификаты, балансировка, лимиты, статические файлы.</p>
<p>Адреса задаются несколькими способами: <code>ASPNETCORE_URLS</code> или <code>--urls</code>, секция <code>Kestrel:Endpoints</code> в конфигурации, вызов <code>builder.WebHost.ConfigureKestrel(...)</code> в коде. С .NET 8 появились переменные <code>ASPNETCORE_HTTP_PORTS</code> и <code>ASPNETCORE_HTTPS_PORTS</code>, а официальные контейнерные образы .NET 8+ по умолчанию слушают порт <strong>8080</strong> (раньше было 80) — это частая причина «приложение в Docker не отвечает» после обновления.</p>
<pre><code>builder.WebHost.ConfigureKestrel(options =&gt;
{
    options.Limits.MaxRequestBodySize = 10 * 1024 * 1024;   // по умолчанию ~28.6 МБ
    options.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(2);
    options.ListenAnyIP(8080);
    options.ListenAnyIP(8081, o =&gt; o.Protocols = HttpProtocols.Http2); // например, для gRPC без TLS
});</code></pre>
<p>За прокси приложение видит не клиента, а прокси: <code>HttpContext.Connection.RemoteIpAddress</code> — адрес nginx, схема — <code>http</code>, хотя клиент пришёл по HTTPS. Это ломает редиректы, генерацию ссылок, OIDC-callback’и и rate limiting по IP. Лечится <strong>Forwarded Headers Middleware</strong>, которое читает <code>X-Forwarded-For</code>, <code>X-Forwarded-Proto</code> и <code>X-Forwarded-Host</code>:</p>
<pre><code>builder.Services.Configure&lt;ForwardedHeadersOptions&gt;(o =&gt;
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    // Доверять заголовкам только от известных прокси, иначе клиент подделает свой IP
    o.KnownProxies.Add(IPAddress.Parse("10.0.0.5"));
});

var app = builder.Build();
app.UseForwardedHeaders();   // самым первым, до всего, что смотрит на схему и IP</code></pre>
<blockquote><strong>Важно.</strong> Доверять <code>X-Forwarded-*</code> от кого угодно нельзя: тогда любой клиент может подставить чужой IP. По умолчанию middleware доверяет только loopback; в Kubernetes, где адреса прокси меняются, обычно настраивают <code>KnownNetworks</code> на подсеть кластера (в .NET 10 это свойство помечено obsolete, замена — <code>KnownIPNetworks</code>).</blockquote>

<h3>Последовательность запуска</h3>
<p>Понимать, что происходит при старте, полезно и для отладки «почему конфиг не подхватился», и для вопроса на собеседовании. Упрощённо:</p>
<ol>
<li><strong>Создание builder’а.</strong> Определяются окружение и content root, собирается конфигурация (сначала host-конфигурация из <code>DOTNET_</code>/<code>ASPNETCORE_</code>-переменных и аргументов, затем конфигурация приложения), настраивается логирование, регистрируются базовые сервисы фреймворка.</li>
<li><strong>Регистрация ваших сервисов</strong> в <code>builder.Services</code>. На этом этапе ничего не создаётся — только описания (<code>ServiceDescriptor</code>).</li>
<li><strong><code>builder.Build()</code>.</strong> Строится <code>ServiceProvider</code>. В Development включены <code>ValidateScopes</code> и <code>ValidateOnBuild</code>, поэтому здесь же всплывают ошибки вроде «не зарегистрирована зависимость» или «scoped внутри singleton».</li>
<li><strong>Построение конвейера</strong>: вызовы <code>app.Use...</code> и <code>app.Map...</code>. Middleware ещё не выполняются — они лишь собираются в цепочку делегатов.</li>
<li><strong><code>app.Run()</code> / <code>RunAsync()</code></strong> вызывает <code>StartAsync</code> хоста: по очереди (по умолчанию последовательно, в порядке регистрации) стартуют все <code>IHostedService</code>, в том числе сервер. Конвейер окончательно компилируется в один <code>RequestDelegate</code>, Kestrel начинает принимать соединения. Срабатывает <code>IHostApplicationLifetime.ApplicationStarted</code>.</li>
<li><strong>Работа</strong> до сигнала остановки: SIGTERM от Kubernetes/Docker, Ctrl+C, <code>StopApplication()</code>.</li>
<li><strong>Graceful shutdown</strong>: <code>ApplicationStopping</code>, сервер перестаёт принимать новые соединения и дожидается текущих запросов, hosted services останавливаются в <em>обратном</em> порядке, затем <code>ApplicationStopped</code> и освобождение контейнера (dispose singleton’ов). На всё это отведён <code>HostOptions.ShutdownTimeout</code> — по умолчанию 30 секунд (начиная с .NET 6; раньше было 5).</li>
</ol>
<p>С .NET 8 у <code>HostOptions</code> есть <code>ServicesStartConcurrently</code> и <code>ServicesStopConcurrently</code>, а интерфейс <code>IHostedLifecycleService</code> добавляет хуки <code>StartingAsync</code>, <code>StartedAsync</code>, <code>StoppingAsync</code>, <code>StoppedAsync</code> — например, чтобы прогреть кэш строго до того, как начнут работать остальные сервисы.</p>
<blockquote><strong>Важно.</strong> Код между <code>Build()</code> и <code>Run()</code> выполняется до старта hosted services. Сюда обычно кладут применение миграций в dev-окружении или прогрев — но в продакшене миграции лучше выносить в отдельный шаг деплоя (init container, migration bundle), чтобы десять реплик не мигрировали базу одновременно.</blockquote>

<h3>Конфигурация: провайдеры и приоритет</h3>
<p>Конфигурация в .NET — это плоский словарь «ключ → строка», собранный из нескольких <strong>провайдеров</strong>. Иерархия выражается двоеточием: <code>Kafka:BootstrapServers</code>. Провайдеры добавляются по порядку, и <strong>каждый следующий перекрывает предыдущие</strong> при совпадении ключа. Для <code>WebApplication.CreateBuilder</code> порядок такой (от слабого к сильному):</p>
<ol>
<li><code>appsettings.json</code>;</li>
<li><code>appsettings.{Environment}.json</code>;</li>
<li>user secrets — только в окружении Development;</li>
<li>переменные окружения;</li>
<li>аргументы командной строки.</li>
</ol>
<p>Так получается удобная модель: в репозитории лежат значения по умолчанию, окружение их переопределяет, а в контейнере всё нужное передаётся через переменные окружения. В переменных окружения иерархия пишется <strong>двойным подчёркиванием</strong>, потому что двоеточие недопустимо в именах переменных на многих платформах: <code>Kafka__BootstrapServers=broker:9092</code>. Массивы — индексами: <code>Kafka__Topics__0=orders</code>.</p>
<pre><code>// Прямое чтение — годится для пары значений при старте
var connectionString = builder.Configuration.GetConnectionString("Default"); // ConnectionStrings:Default
var timeout = builder.Configuration.GetValue&lt;int&gt;("Http:TimeoutSeconds", 30);

// Свой провайдер добавляется в конец — значит, имеет наивысший приоритет
builder.Configuration.AddJsonFile("secrets/kafka.json", optional: true, reloadOnChange: true);</code></pre>
<p>Ключи сравниваются <strong>без учёта регистра</strong>. Значения — всегда строки; типизация происходит при биндинге. JSON-файлы по умолчанию подключены с <code>reloadOnChange: true</code>, то есть изменение файла на диске обновит <code>IConfiguration</code> на лету — это пригодится в Options pattern.</p>
<p>Отдельно стоит <strong>host configuration</strong>: переменные с префиксами <code>DOTNET_</code> и <code>ASPNETCORE_</code> (например, <code>ASPNETCORE_ENVIRONMENT</code>, <code>ASPNETCORE_URLS</code>) читаются раньше, потому что от них зависит, какие файлы appsettings вообще загружать.</p>
<blockquote><strong>Важно.</strong> Секреты не кладут в <code>appsettings.json</code>. В разработке — user secrets (хранятся в профиле пользователя, вне репозитория), в продакшене — переменные окружения из секретов Kubernetes, Vault, Azure Key Vault и т.п. User secrets — не механизм безопасности, а лишь способ не закоммитить пароль случайно.</blockquote>

<h3>Options pattern</h3>
<p>Читать <code>IConfiguration</code> строками по всему коду — плохая идея: опечатки в ключах, отсутствие типов, невозможность тестировать. <strong>Options pattern</strong> связывает секцию конфигурации с классом и отдаёт его через DI.</p>
<pre><code>public sealed class KafkaOptions
{
    public const string Section = "Kafka";
    public required string BootstrapServers { get; init; }
    public string GroupId { get; init; } = "warehouse";
    public int MaxPollRecords { get; init; } = 500;
}

builder.Services.Configure&lt;KafkaOptions&gt;(builder.Configuration.GetSection(KafkaOptions.Section));</code></pre>
<p>Получить значение можно тремя интерфейсами, и разница между ними — классический вопрос:</p>
<table>
<thead><tr><th>Интерфейс</th><th>Время жизни</th><th>Видит изменения</th><th>Когда использовать</th></tr></thead>
<tbody>
<tr><td><code>IOptions&lt;T&gt;</code></td><td>singleton</td><td>нет, значение вычисляется один раз</td><td>настройки, которые не меняются во время работы</td></tr>
<tr><td><code>IOptionsSnapshot&lt;T&gt;</code></td><td>scoped</td><td>да, пересчитывается на каждый scope (запрос)</td><td>веб-код, где нужно свежее значение на запрос; поддерживает named options</td></tr>
<tr><td><code>IOptionsMonitor&lt;T&gt;</code></td><td>singleton</td><td>да, <code>CurrentValue</code> всегда актуален, есть <code>OnChange</code></td><td>singleton’ы и фоновые сервисы, которым нужна перезагрузка</td></tr>
</tbody>
</table>
<p>Важная ловушка: <code>IOptionsSnapshot</code> — scoped, поэтому его <strong>нельзя</strong> внедрить в singleton (получится captive dependency, а при включённой проверке scopes — исключение). В singleton и <code>BackgroundService</code> используют <code>IOptionsMonitor</code>.</p>
<pre><code>public sealed class OrdersConsumer(IOptionsMonitor&lt;KafkaOptions&gt; options) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var batchSize = options.CurrentValue.MaxPollRecords; // актуальное значение на каждой итерации
            // ...
        }
    }
}</code></pre>
<p><strong>Named options</strong> позволяют иметь несколько экземпляров одного типа: <code>Configure&lt;HttpTargetOptions&gt;("payments", ...)</code> и <code>monitor.Get("payments")</code>. Для донастройки после биндинга есть <code>PostConfigure</code>, а для настройки, которой нужны другие сервисы, — <code>IConfigureOptions&lt;T&gt;</code> или <code>services.AddOptions&lt;T&gt;().Configure&lt;IDependency&gt;((o, dep) =&gt; ...)</code>.</p>

<h3>Валидация options</h3>
<p>Конфигурация без проверки — источник ночных инцидентов: приложение стартует, проходит health check, а через час первый же запрос к Kafka падает, потому что в переменной окружения опечатка. Правило senior-уровня: <strong>fail fast</strong> — приложение с неверной конфигурацией не должно стартовать вовсе.</p>
<pre><code>builder.Services.AddOptions&lt;KafkaOptions&gt;()
    .BindConfiguration(KafkaOptions.Section)
    .ValidateDataAnnotations()                       // [Required], [Range] и т.п. на свойствах
    .Validate(o =&gt; o.MaxPollRecords is &gt; 0 and &lt;= 5000, "MaxPollRecords out of range")
    .ValidateOnStart();                              // проверить при старте хоста, а не при первом обращении</code></pre>
<p>Без <code>ValidateOnStart</code> валидация ленивая: исключение <code>OptionsValidationException</code> вылетит при первом обращении к <code>.Value</code> — возможно, глубоко в обработке запроса. С ним проверка выполняется при запуске хоста. В .NET 8 появился сокращённый вызов <code>AddOptionsWithValidateOnStart&lt;T&gt;()</code>.</p>
<p>Для сложных правил реализуют <code>IValidateOptions&lt;T&gt;</code> — это обычный сервис, ему можно внедрять зависимости:</p>
<pre><code>public sealed class KafkaOptionsValidator : IValidateOptions&lt;KafkaOptions&gt;
{
    public ValidateOptionsResult Validate(string? name, KafkaOptions o)
    {
        if (string.IsNullOrWhiteSpace(o.BootstrapServers))
            return ValidateOptionsResult.Fail("Kafka:BootstrapServers is required");
        return ValidateOptionsResult.Success;
    }
}

builder.Services.AddSingleton&lt;IValidateOptions&lt;KafkaOptions&gt;, KafkaOptionsValidator&gt;();</code></pre>
<p>В .NET 8 добавлен source generator <code>[OptionsValidator]</code>: он генерирует валидатор по DataAnnotations без рефлексии, что важно для trimming и Native AOT.</p>
<blockquote><strong>Важно.</strong> При перезагрузке конфигурации <code>IOptionsMonitor</code> тоже валидирует новое значение; если оно невалидно, <code>CurrentValue</code> бросит исключение. Это стоит учитывать в сервисах, которые читают настройки в цикле.</blockquote>

<h3>Окружения</h3>
<p>Окружение задаётся переменной <code>ASPNETCORE_ENVIRONMENT</code> (или <code>DOTNET_ENVIRONMENT</code>; для веб-приложений приоритет у первой). Значение по умолчанию — <strong>Production</strong>: если переменную забыли выставить, приложение поведёт себя как продакшен, что безопаснее обратного. Стандартные имена — <code>Development</code>, <code>Staging</code>, <code>Production</code>, но можно использовать любые.</p>
<p>Окружение влияет на три вещи: какой <code>appsettings.{Environment}.json</code> подгружается; подключаются ли user secrets (только Development); и на ваш собственный код через <code>IHostEnvironment</code>:</p>
<pre><code>if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();          // документацию часто публикуют только в dev/staging
}
else
{
    app.UseExceptionHandler();
    app.UseHsts();
}</code></pre>
<p>В Development по умолчанию показывается Developer Exception Page со стектрейсом — поэтому окружение Development на публичном сервере недопустимо: стектрейсы и детали конфигурации утекут наружу. Хорошая практика — держать различия между окружениями <strong>в конфигурации</strong>, а не в ветках <code>if (IsProduction())</code> по всему коду: такие ветки не тестируются нигде, кроме продакшена.</p>

<h3>Логирование: основы</h3>
<p>Абстракция — <code>ILogger&lt;TCategory&gt;</code> из <code>Microsoft.Extensions.Logging</code>. Категория — обычно полное имя класса; по ней фильтруют уровни. Провайдеры (Console, Debug, EventSource, OpenTelemetry, Serilog через адаптер) получают записи и решают, куда их писать. Уровни: <code>Trace</code>, <code>Debug</code>, <code>Information</code>, <code>Warning</code>, <code>Error</code>, <code>Critical</code>, <code>None</code>.</p>
<pre><code>// appsettings.json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.EntityFrameworkCore.Database.Command": "Warning"
    }
  }
}</code></pre>
<p>Самое важное правило — <strong>structured logging</strong>: передавать значения как параметры шаблона, а не склеивать строку.</p>
<pre><code>// Плохо: строка собирается всегда, даже если уровень отключён; поля OrderId в логах нет
logger.LogInformation($"Order {order.Id} reserved for {sw.ElapsedMilliseconds} ms");

// Хорошо: шаблон постоянный, OrderId и ElapsedMs станут отдельными полями
logger.LogInformation("Order {OrderId} reserved in {ElapsedMs} ms", order.Id, sw.ElapsedMilliseconds);</code></pre>
<p>Имена в фигурных скобках — это имена свойств, а не позиции: в Seq, Elasticsearch или Loki по ним потом фильтруют («все записи с OrderId = 42»). Шаблон сообщения при этом постоянный, и система логов может группировать по нему одинаковые события. Для общего контекста (номер заказа, tenant, correlation id) используют <strong>scopes</strong>: <code>using (logger.BeginScope(new Dictionary&lt;string, object&gt; { ["TenantId"] = tenantId })) { ... }</code> — все записи внутри получат это поле, если провайдер поддерживает scopes. Для горячих путей есть source generator <code>[LoggerMessage]</code>; о нём — в главе про производительность.</p>
<blockquote><strong>Важно.</strong> Никогда не логируйте токены, пароли, полные тела запросов с персональными данными. Логи живут дольше и доступны большему числу людей, чем база.</blockquote>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Чем WebApplication отличается от Generic Host?»</summary>
<p>Это не разные хосты: <code>WebApplication</code> — обёртка над Generic Host, появившаяся в .NET 6 вместе с minimal hosting model. Под капотом тот же <code>IHost</code> с DI-контейнером, конфигурацией, логированием и hosted services, а Kestrel запускается как один из hosted services. Разница в удобстве: <code>WebApplication</code> одновременно реализует <code>IHost</code>, <code>IApplicationBuilder</code> и <code>IEndpointRouteBuilder</code>, поэтому весь старт умещается в плоский <code>Program.cs</code> без класса <code>Startup</code>. Для сервисов без HTTP — например, consumer’а Kafka — я беру <code>Host.CreateApplicationBuilder</code>: та же модель без веб-сервера. Ключевая граница в обоих случаях — <code>Build()</code>: до него регистрация сервисов, после — конвейер и запуск.</p>
</details>
<details><summary>«В каком порядке применяются источники конфигурации и как переопределить значение в Kubernetes?»</summary>
<p>Каждый следующий провайдер перекрывает предыдущие: <code>appsettings.json</code>, затем <code>appsettings.{Environment}.json</code>, затем user secrets (только в Development), переменные окружения и, наконец, аргументы командной строки. В Kubernetes значение переопределяют переменной окружения, заменяя двоеточие на двойное подчёркивание: <code>Kafka__BootstrapServers</code>. Секреты приходят из Secret через env или как файл, подключённый отдельным провайдером. Ключи нечувствительны к регистру, значения — строки, типизируются при биндинге. Отдельно читается host configuration с префиксами <code>ASPNETCORE_</code> и <code>DOTNET_</code>, потому что от неё зависит, например, окружение и, значит, какие файлы appsettings грузить.</p>
</details>
<details><summary>«IOptions, IOptionsSnapshot, IOptionsMonitor — в чём разница?»</summary>
<p><code>IOptions&lt;T&gt;</code> — singleton, значение вычисляется один раз и больше не меняется. <code>IOptionsSnapshot&lt;T&gt;</code> — scoped: пересчитывается на каждый scope, то есть на каждый HTTP-запрос, видит изменения конфигурации и поддерживает named options. <code>IOptionsMonitor&lt;T&gt;</code> — singleton, но <code>CurrentValue</code> всегда актуален, и можно подписаться на <code>OnChange</code>. Практическое правило: в singleton и фоновых сервисах — только <code>IOptionsMonitor</code>, потому что snapshot внутри singleton — это captive dependency, и проверка scopes упадёт. В обычном коде запроса, если настройки статичны, достаточно <code>IOptions</code>.</p>
</details>
<details><summary>«Как сделать так, чтобы приложение с неправильной конфигурацией не стартовало?»</summary>
<p>Через валидацию options с <code>ValidateOnStart</code>: <code>AddOptions&lt;T&gt;().BindConfiguration(...).ValidateDataAnnotations().ValidateOnStart()</code>, в .NET 8 — короче через <code>AddOptionsWithValidateOnStart</code>. Без <code>ValidateOnStart</code> валидация ленивая и сработает только при первом обращении к <code>Value</code>, возможно, через час работы. Сложные правила выношу в <code>IValidateOptions&lt;T&gt;</code>, ему можно внедрять зависимости. Для AOT есть source generator <code>[OptionsValidator]</code>. Плюс в Development включены <code>ValidateOnBuild</code> и <code>ValidateScopes</code>, которые ловят ошибки регистрации DI при <code>Build()</code>. Смысл — упасть при деплое, где это видно сразу, а не на запросе пользователя.</p>
</details>
<details><summary>«Что происходит при остановке приложения в Kubernetes?»</summary>
<p>Kubelet шлёт SIGTERM, хост ловит его и начинает graceful shutdown: срабатывает <code>ApplicationStopping</code>, Kestrel перестаёт принимать новые соединения и дожидается текущих запросов, hosted services останавливаются в обратном порядке — у <code>BackgroundService</code> отменяется <code>stoppingToken</code>. На всё есть <code>HostOptions.ShutdownTimeout</code>, по умолчанию 30 секунд. Его стоит согласовать с <code>terminationGracePeriodSeconds</code> пода, иначе Kubernetes пришлёт SIGKILL раньше, чем приложение закончит. Ещё нюанс: эндпоинты пода удаляются из Service асинхронно, поэтому какое-то время трафик может ещё приходить — часто добавляют небольшую задержку в preStop. Для consumer’а Kafka важно на остановке закоммитить офсеты обработанных сообщений и корректно выйти из группы, чтобы ребалансировка прошла быстро.</p>
</details>
<details><summary>«Почему приложение за nginx видит неправильный IP и схему, и как это исправить?»</summary>
<p>Потому что TCP-соединение к Kestrel открывает прокси: <code>RemoteIpAddress</code> — это адрес nginx, а схема — <code>http</code>, если TLS терминирован на прокси. Последствия: неправильные редиректы и абсолютные ссылки, ломается OIDC redirect URI, rate limiting по IP режет всех сразу. Исправляет <code>UseForwardedHeaders</code> с настройкой <code>ForwardedHeaders.XForwardedFor | XForwardedProto</code>; его ставят первым в конвейере. Принципиально важно ограничить доверие через <code>KnownProxies</code> или <code>KnownNetworks</code>, иначе клиент сам пришлёт <code>X-Forwarded-For</code> и подменит свой адрес.</p>
</details>
<details><summary>«Как правильно логировать в .NET?»</summary>
<p>Через <code>ILogger&lt;T&gt;</code> и structured logging: постоянный шаблон сообщения с именованными плейсхолдерами и значения отдельными аргументами. Интерполяция строки — антипаттерн: строка собирается даже при выключенном уровне, а в системе логов теряются отдельные поля, по которым потом ищут. Общий контекст — tenant, номер заказа, correlation id — кладу в scope, чтобы не повторять в каждой записи. Уровни настраиваются по категориям в конфигурации, шумный <code>Microsoft.AspNetCore</code> обычно поднимают до Warning. В горячих местах — <code>[LoggerMessage]</code>-генератор, чтобы не было аллокаций и боксинга. И никаких токенов и персональных данных в логах.</p>
</details>`},

    { id: 'middleware', title: 'Конвейер middleware', html: `<h3>Как устроен конвейер</h3>
<p>Обработка HTTP-запроса в ASP.NET Core — это цепочка <strong>middleware</strong>. Каждое middleware — функция, которая получает <code>HttpContext</code> и ссылку на следующее звено <code>next</code>. Оно может сделать что-то до вызова <code>next</code>, вызвать его (передать запрос дальше), сделать что-то после — когда ответ уже сформирован внутренними звеньями, — или не вызывать <code>next</code> вовсе и ответить само.</p>
<p>Технически всё сводится к одному типу: <code>delegate Task RequestDelegate(HttpContext context)</code>. Middleware — это <code>Func&lt;RequestDelegate, RequestDelegate&gt;</code>: «дай мне следующее звено, и я верну функцию, которая его оборачивает». При старте приложения фреймворк проходит регистрации <strong>с конца</strong> и сворачивает их в один делегат — луковица, в центре которой эндпоинт.</p>
<pre><code>app.Use(async (context, next) =&gt;
{
    var sw = Stopwatch.StartNew();
    await next(context);                       // всё, что зарегистрировано дальше
    // сюда возвращаемся, когда внутренние звенья отработали
    logger.LogInformation("{Path} -&gt; {Status} in {Ms} ms",
        context.Request.Path, context.Response.StatusCode, sw.ElapsedMilliseconds);
});</code></pre>
<p>Из этой модели следуют все практические правила:</p>
<ul>
<li><strong>порядок регистрации — это порядок выполнения</strong> на входе и обратный порядок на выходе;</li>
<li>middleware, зарегистрированное раньше, «видит» исключения и ответы всех последующих — поэтому обработчик исключений ставят первым;</li>
<li>middleware, которое не вызвало <code>next</code>, обрывает конвейер (short-circuit) — так работают статические файлы, CORS preflight, health checks, отказ в rate limiting;</li>
<li>конвейер строится <strong>один раз</strong> при старте; сами middleware в стиле конвенции тоже создаются один раз и живут как singleton.</li>
</ul>
<blockquote><strong>Важно.</strong> Middleware — про сквозную обработку всех запросов (логирование, корреляция, заголовки безопасности, tenant). Логика, зависящая от конкретного действия контроллера и его аргументов, лучше живёт в фильтрах MVC или endpoint filters: у них есть доступ к модели и метаданным действия.</blockquote>

<h3>Use, Run, Map и их варианты</h3>
<p>Есть несколько способов добавить звено, и на собеседовании любят спросить разницу:</p>
<ul>
<li><code>Use</code> — обычное звено, получает <code>next</code> и, как правило, его вызывает;</li>
<li><code>Run</code> — терминальное звено, <code>next</code> не получает. Всё, что зарегистрировано после <code>Run</code>, никогда не выполнится;</li>
<li><code>Map("/path", branch =&gt; ...)</code> — ответвление по префиксу пути. Внутри ветки префикс отрезается от <code>Request.Path</code> и переносится в <code>PathBase</code>. Ветка в основной конвейер <strong>не возвращается</strong>;</li>
<li><code>MapWhen(predicate, branch =&gt; ...)</code> — то же по произвольному условию;</li>
<li><code>UseWhen(predicate, branch =&gt; ...)</code> — условная ветка, которая <strong>возвращается</strong> в основной конвейер, если внутри не было short-circuit. Удобно, чтобы, например, включить middleware только для <code>/api</code>.</li>
</ul>
<pre><code>app.UseWhen(ctx =&gt; ctx.Request.Path.StartsWithSegments("/api"), api =&gt;
{
    api.UseMiddleware&lt;TenantResolutionMiddleware&gt;();   // только для API, дальше — общий конвейер
});

app.Map("/internal/ping", branch =&gt;
{
    branch.Run(ctx =&gt; ctx.Response.WriteAsync("pong")); // ветка, конец
});

app.Run(ctx =&gt; ctx.Response.WriteAsync("fallback"));
app.Use(async (ctx, next) =&gt; { /* никогда не выполнится */ await next(ctx); });</code></pre>
<p>Не путайте <code>app.Map("/x", branch =&gt; ...)</code> на <code>IApplicationBuilder</code> (ветка конвейера) с <code>app.MapGet("/x", handler)</code> на <code>IEndpointRouteBuilder</code> (регистрация эндпоинта в маршрутизаторе). Названия похожи, механизмы разные: первый — грубое разветвление middleware по пути, второй — часть endpoint routing с шаблонами, ограничениями и метаданными.</p>

<h3>Порядок middleware</h3>
<p>Рекомендуемый порядок встроенных компонентов (не всё нужно каждому приложению):</p>
<ol>
<li><code>UseForwardedHeaders</code> — если за прокси: всё последующее должно видеть правильные схему и IP;</li>
<li><code>UseExceptionHandler</code> (в dev — Developer Exception Page) — самым внешним, чтобы ловить исключения всех остальных;</li>
<li><code>UseHsts</code> — заголовок Strict-Transport-Security, не в Development;</li>
<li><code>UseHttpsRedirection</code>;</li>
<li><code>UseStaticFiles</code> — до маршрутизации и авторизации, чтобы статика отдавалась дёшево (и, соответственно, без авторизации);</li>
<li><code>UseRouting</code> — выбирает эндпоинт;</li>
<li><code>UseCors</code> — после маршрутизации (чтобы видеть политику эндпоинта) и до аутентификации; обязательно — <strong>до</strong> авторизации, иначе preflight-запрос без токена получит 401;</li>
<li><code>UseAuthentication</code> — заполняет <code>HttpContext.User</code>;</li>
<li><code>UseAuthorization</code> — читает метаданные выбранного эндпоинта (<code>[Authorize]</code>, политики) и пользователя;</li>
<li>ваши middleware, которым нужен пользователь (tenant, аудит), rate limiting с политиками эндпоинтов, output caching;</li>
<li>эндпоинты: <code>MapControllers</code>, <code>MapGet</code> и т.д.</li>
</ol>
<p>Логика порядка: каждое звено должно стоять <strong>после</strong> того, от чего зависит, и <strong>до</strong> того, что от него зависит. Авторизации нужен пользователь (значит, после аутентификации) и эндпоинт с его атрибутами (значит, после маршрутизации). Обработчику исключений нужно обернуть всех — значит, первым.</p>
<p><code>WebApplication</code> упрощает жизнь: если вы не вызвали <code>UseRouting</code>, он добавит маршрутизацию в начало конвейера сам, а выполнение эндпоинтов — в конец. Но если вам нужно middleware <em>до</em> маршрутизации и другое — <em>после</em>, вызывайте <code>UseRouting</code> явно: явный порядок читается лучше и не зависит от неявных правил.</p>
<pre><code>// Ошибка, которую встречают на ревью
app.UseAuthorization();
app.UseAuthentication();   // поздно: авторизация уже отработала с анонимным пользователем
app.MapControllers();
// Итог: все эндпоинты с [Authorize] отвечают 401 даже с валидным токеном</code></pre>
<blockquote><strong>Важно.</strong> Если обработчик исключений стоит не первым, исключения из middleware перед ним не будут превращены в ProblemDetails: клиент получит пустой 500 от сервера, а не ваш стандартный формат ошибки.</blockquote>

<h3>Свой middleware: класс по конвенции</h3>
<p>Лямбды в <code>app.Use</code> хороши для пары строк; всё серьёзное оформляют классом. Классический способ — <strong>convention-based middleware</strong>: класс с конструктором, принимающим <code>RequestDelegate next</code>, и публичным методом <code>Invoke</code> или <code>InvokeAsync</code>, первый параметр которого — <code>HttpContext</code>. Интерфейса нет, фреймворк находит метод по соглашению.</p>
<pre><code>public sealed class CorrelationIdMiddleware(RequestDelegate next, ILogger&lt;CorrelationIdMiddleware&gt; logger)
{
    private const string Header = "X-Correlation-Id";

    // Scoped-зависимости — ТОЛЬКО параметрами InvokeAsync, не в конструктор
    public async Task InvokeAsync(HttpContext context, ICorrelationContext correlation)
    {
        var id = context.Request.Headers.TryGetValue(Header, out var value) &amp;&amp; !string.IsNullOrEmpty(value)
            ? value.ToString()
            : Guid.NewGuid().ToString("N");

        correlation.Id = id;
        context.Response.OnStarting(() =&gt;
        {
            context.Response.Headers[Header] = id;   // заголовки можно менять только до начала ответа
            return Task.CompletedTask;
        });

        using (logger.BeginScope(new Dictionary&lt;string, object&gt; { ["CorrelationId"] = id }))
        {
            await next(context);
        }
    }
}

app.UseMiddleware&lt;CorrelationIdMiddleware&gt;();</code></pre>
<p>Ключевая деталь: такой класс создаётся <strong>один раз</strong> при построении конвейера, то есть фактически является singleton. Поэтому в конструктор можно внедрять только singleton-зависимости (логгер, <code>IOptionsMonitor</code>). Scoped-сервисы — <code>DbContext</code>, контекст текущего tenant’а — передаются параметрами <code>InvokeAsync</code>: фреймворк резолвит их из scope текущего запроса при каждом вызове. Если внедрить <code>DbContext</code> в конструктор, получится captive dependency: один контекст на все запросы всех пользователей — с гонками, утечкой данных между запросами и растущим change tracker’ом. При включённой проверке scopes это упадёт при старте.</p>

<h3>IMiddleware и фабрика</h3>
<p>Альтернатива — интерфейс <code>IMiddleware</code> с методом <code>InvokeAsync(HttpContext context, RequestDelegate next)</code>. Такой класс <strong>регистрируется в DI</strong> с нужным временем жизни и создаётся через <code>IMiddlewareFactory</code> на каждый запрос (точнее, резолвится из scope запроса), поэтому scoped-зависимости можно спокойно внедрять в конструктор.</p>
<pre><code>public sealed class TenantMiddleware(ITenantStore store, ITenantContext tenant) : IMiddleware
{
    public async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        var header = context.Request.Headers["X-Tenant-Id"].ToString();
        if (!Guid.TryParse(header, out var tenantId) || !await store.ExistsAsync(tenantId))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;  // short-circuit
            return;
        }
        tenant.Id = tenantId;
        await next(context);
    }
}

builder.Services.AddScoped&lt;TenantMiddleware&gt;();   // обязательно: без регистрации первый же запрос упадёт при создании middleware
app.UseMiddleware&lt;TenantMiddleware&gt;();</code></pre>
<table>
<thead><tr><th></th><th>Конвенция</th><th>IMiddleware</th></tr></thead>
<tbody>
<tr><td>Создание</td><td>один раз при старте</td><td>из DI на каждый запрос</td></tr>
<tr><td>Регистрация в DI</td><td>не нужна</td><td>обязательна</td></tr>
<tr><td>Scoped-зависимости</td><td>параметрами <code>InvokeAsync</code></td><td>в конструкторе</td></tr>
<tr><td>Строгая типизация</td><td>нет, сигнатура по соглашению</td><td>да, интерфейс</td></tr>
<tr><td>Стоимость</td><td>минимальная</td><td>резолв объекта на каждый запрос</td></tr>
</tbody>
</table>
<p>Встроенные middleware фреймворка написаны по конвенции — это самый дешёвый вариант. <code>IMiddleware</code> выбирают, когда важны явный контракт и удобство конструктора со scoped-зависимостями. Оба варианта легко тестируются: создаёте <code>DefaultHttpContext</code>, передаёте заглушку <code>next</code> и проверяете результат.</p>

<h3>Short-circuiting и запись ответа</h3>
<p>Middleware обрывает конвейер, просто не вызывая <code>next</code>. Так делают проверки, после которых продолжать бессмысленно: неизвестный tenant, превышен лимит запросов, ответ уже есть в кэше, CORS preflight. Всё, что стоит после, не выполнится — и это экономит ресурсы.</p>
<p>Важное ограничение HTTP: <strong>статус и заголовки уходят клиенту до тела</strong>. Как только тело начали писать (или буфер сбросился), ответ «начался» — <code>context.Response.HasStarted == true</code>, и менять статус или заголовки уже нельзя: будет исключение. Отсюда два правила:</p>
<ul>
<li>заголовки, которые нужно добавить к любому ответу, добавляют через <code>Response.OnStarting(...)</code> — колбэк выполнится прямо перед отправкой заголовков;</li>
<li>обработчик исключений проверяет <code>HasStarted</code>: если ответ уже частично ушёл (например, при стриминге), подменить его на ProblemDetails невозможно — остаётся залогировать и оборвать соединение.</li>
</ul>
<pre><code>app.Use(async (context, next) =&gt;
{
    await next(context);
    // Плохо: если эндпоинт уже записал тело, здесь будет InvalidOperationException
    // context.Response.Headers["X-Server-Time"] = DateTime.UtcNow.ToString("O");
});</code></pre>
<p>С .NET 8 у endpoint routing есть собственный short-circuit: вызов <code>.ShortCircuit()</code> у эндпоинта или <code>app.MapShortCircuit(404, "robots.txt", "favicon.ico")</code>. Такой эндпоинт выполняется сразу после маршрутизации, минуя остальные middleware (аутентификацию, авторизацию и т.д.) — удобно для мусорных запросов, которые не стоит прогонять через весь конвейер.</p>

<h3>Endpoint routing</h3>
<p>С ASP.NET Core 3.0 маршрутизация разделена на две фазы. <strong>UseRouting</strong> сопоставляет запрос с одним из зарегистрированных эндпоинтов и кладёт его в контекст (<code>context.GetEndpoint()</code>), вместе с route values. <strong>Выполнение эндпоинта</strong> происходит в конце конвейера. Между этими двумя точками любое middleware уже знает, какой эндпоинт будет вызван, и может прочитать его <strong>метаданные</strong>: атрибуты <code>[Authorize]</code>, политику CORS, политику rate limiting, кэширования и ваши собственные.</p>
<pre><code>app.UseRouting();
app.Use(async (context, next) =&gt;
{
    var endpoint = context.GetEndpoint();
    if (endpoint?.Metadata.GetMetadata&lt;RequiresTenantAttribute&gt;() is not null
        &amp;&amp; !context.Request.Headers.ContainsKey("X-Tenant-Id"))
    {
        context.Response.StatusCode = 400;
        return;
    }
    await next(context);
});
app.UseAuthorization();

app.MapGet("/orders/{id:guid}", (Guid id) =&gt; ...)
   .WithMetadata(new RequiresTenantAttribute())
   .RequireAuthorization("orders.read");</code></pre>
<p>Именно поэтому авторизация и CORS — это middleware, стоящие после маршрутизации: они реализованы обобщённо и узнают требования конкретного эндпоинта из его метаданных. И контроллеры, и minimal APIs, и gRPC, и health checks, и SignalR — всё это эндпоинты одной системы маршрутизации, поэтому политики применяются к ним единообразно.</p>
<p>Шаблоны маршрутов поддерживают параметры и ограничения: <code>{id:int}</code>, <code>{id:guid}</code>, <code>{slug:regex(...)}</code>, необязательные <code>{page?}</code>, catch-all <code>{**path}</code>. Ограничения — это про выбор маршрута, а не про валидацию: при несовпадении ограничения маршрут просто не подходит, и клиент получит 404, а не 400. Если нужна ошибка валидации, принимайте строку и проверяйте её сами. При неоднозначности (два эндпоинта одинаково подходят) маршрутизатор бросит <code>AmbiguousMatchException</code> — это ловится тестами, а не в продакшене.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Как работает конвейер middleware и почему важен порядок?»</summary>
<p>Конвейер — это цепочка делегатов <code>RequestDelegate</code>: каждое middleware получает контекст и ссылку на следующее звено, может работать до и после вызова <code>next</code> или не вызывать его вовсе. При старте регистрации сворачиваются в один делегат, луковицей вокруг эндпоинта. Поэтому порядок регистрации — это порядок выполнения на входе и обратный на выходе. Звено должно стоять после того, от чего зависит: авторизация — после аутентификации, потому что ей нужен пользователь, и после маршрутизации, потому что ей нужны атрибуты эндпоинта. Обработчик исключений ставится первым, чтобы оборачивать всех. CORS — после маршрутизации и до аутентификации и авторизации, чтобы preflight без токена не получал 401 от авторизации.</p>
</details>
<details><summary>«Чем отличаются Use, Run, Map и UseWhen?»</summary>
<p><code>Use</code> добавляет обычное звено, которое получает <code>next</code>. <code>Run</code> — терминальное: <code>next</code> у него нет, всё зарегистрированное после него недостижимо. <code>Map</code> создаёт отдельную ветку конвейера по префиксу пути, отрезает префикс в <code>PathBase</code> и в основной конвейер не возвращается; <code>MapWhen</code> — то же по предикату. <code>UseWhen</code> — условная ветка, которая после выполнения возвращается в основной поток, если не оборвалась. Отдельно стоит не путать <code>Map</code> на <code>IApplicationBuilder</code> с <code>MapGet</code>: второе — регистрация эндпоинта в маршрутизации с шаблонами и метаданными.</p>
</details>
<details><summary>«Конвенционный middleware или IMiddleware — что выберешь и почему?»</summary>
<p>Конвенционный создаётся один раз при построении конвейера и фактически singleton, поэтому в конструктор — только singleton-зависимости, а scoped передаются параметрами <code>InvokeAsync</code> и резолвятся на каждый запрос. Это самый дешёвый вариант, так написаны встроенные middleware. <code>IMiddleware</code> регистрируется в DI с выбранным временем жизни и резолвится через <code>IMiddlewareFactory</code> на каждый запрос, так что scoped-зависимости можно брать в конструктор, а контракт строго типизирован. Минус — его обязательно регистрировать, иначе запрос упадёт, когда фабрика попытается его создать, и небольшая стоимость резолва. Для простого сквозного кода я беру конвенцию, для middleware со scoped-сервисами — <code>IMiddleware</code>, это меньше шансов на captive dependency.</p>
</details>
<details><summary>«Что будет, если внедрить DbContext в конструктор конвенционного middleware?»</summary>
<p>Middleware создаётся один раз, поэтому <code>DbContext</code>, зарегистрированный как scoped, будет захвачен singleton’ом — captive dependency. В Development с <code>ValidateScopes</code> приложение упадёт ещё при старте с ошибкой «cannot consume scoped service from singleton». Если проверка выключена, один контекст окажется общим для всех параллельных запросов: <code>DbContext</code> не потокобезопасен, будут исключения о параллельных операциях, данные одного запроса утекут в другой через change tracker, а память будет расти. Правильно — принять <code>DbContext</code> параметром <code>InvokeAsync</code> или использовать <code>IMiddleware</code>.</p>
</details>
<details><summary>«Почему нельзя добавить заголовок ответа после await next()?»</summary>
<p>Потому что по HTTP статус и заголовки отправляются раньше тела. Если внутреннее звено уже начало писать тело, ответ «начался», <code>Response.HasStarted</code> равен true, и изменение заголовков бросит исключение. Решение — зарегистрировать колбэк <code>Response.OnStarting</code> до вызова <code>next</code>: он выполнится непосредственно перед отправкой заголовков. По той же причине обработчик исключений не может превратить в ProblemDetails ответ, который уже частично ушёл при стриминге, — только залогировать и прервать.</p>
</details>
<details><summary>«Что такое endpoint routing и зачем его разделили на две фазы?»</summary>
<p><code>UseRouting</code> выбирает эндпоинт и кладёт его в <code>HttpContext</code>, а выполнение происходит в конце конвейера. Между ними middleware видят выбранный эндпоинт и его метаданные. Это позволило сделать авторизацию, CORS, rate limiting и output caching обобщёнными middleware, которые узнают требования конкретного эндпоинта из атрибутов или вызовов <code>RequireAuthorization</code>, <code>RequireCors</code> и т.п. Контроллеры, minimal APIs, gRPC, health checks — всё это эндпоинты одной системы, поэтому политики применяются одинаково. Ограничения маршрутов вроде <code>{id:int}</code> влияют на выбор маршрута, а не на валидацию: несовпадение даёт 404.</p>
</details>
<details><summary>«Где в конвейере место для определения tenant’а в multi-tenant API?»</summary>
<p>После аутентификации, потому что tenant часто берётся из claims или нужно проверить, что пользователь в нём состоит, и после маршрутизации, чтобы видеть метаданные эндпоинта — некоторые эндпоинты не привязаны к tenant’у. До авторизации, если политики зависят от прав пользователя в конкретном tenant’е, либо как часть авторизации — через фильтр или authorization handler. Сам middleware кладёт найденный tenant в scoped-сервис контекста, из которого его читают <code>DbContext</code> и сервисы. Неизвестный или чужой tenant лучше отдавать как 404, а не 403, чтобы не подтверждать его существование. Альтернатива — action filter в MVC, если правило касается только контроллеров.</p>
</details>`},

    { id: 'di', title: 'Dependency Injection', html: `<h3>Контейнер и регистрации</h3>
<p>Встроенный контейнер <code>Microsoft.Extensions.DependencyInjection</code> — намеренно минималистичный. Вы добавляете в <code>IServiceCollection</code> описания (<code>ServiceDescriptor</code>: тип сервиса, реализация или фабрика, время жизни), при <code>Build()</code> из них строится <code>IServiceProvider</code>, и дальше он создаёт объекты, сам разбирая зависимости из конструкторов (<strong>constructor injection</strong>).</p>
<pre><code>builder.Services.AddSingleton&lt;IClock, SystemClock&gt;();
builder.Services.AddScoped&lt;IOrderRepository, OrderRepository&gt;();
builder.Services.AddTransient&lt;IPriceCalculator, PriceCalculator&gt;();

// Открытый generic: IRepository&lt;Order&gt; разрешится в EfRepository&lt;Order&gt;
builder.Services.AddScoped(typeof(IRepository&lt;&gt;), typeof(EfRepository&lt;&gt;));

// Фабрика — когда нужны параметры, которых нет в контейнере
builder.Services.AddSingleton&lt;IProducer&lt;string, byte[]&gt;&gt;(sp =&gt;
{
    var options = sp.GetRequiredService&lt;IOptions&lt;KafkaOptions&gt;&gt;().Value;
    return new ProducerBuilder&lt;string, byte[]&gt;(new ProducerConfig { BootstrapServers = options.BootstrapServers }).Build();
});</code></pre>
<p>Несколько правил, которые нужно знать наизусть:</p>
<ul>
<li>если один интерфейс зарегистрирован несколько раз, <code>GetService&lt;T&gt;</code> вернёт <strong>последнюю</strong> регистрацию, а <code>IEnumerable&lt;T&gt;</code> — все, в порядке регистрации. На этом строятся «наборы» обработчиков, валидаторов, стратегий;</li>
<li><code>TryAddScoped</code> и прочие <code>TryAdd*</code> добавляют регистрацию, только если для этого сервиса её ещё нет, — так библиотеки дают значения по умолчанию, которые приложение может переопределить. <code>TryAddEnumerable</code> не даёт дважды добавить одну и ту же реализацию в набор;</li>
<li>если у класса несколько конструкторов, контейнер выбирает тот, у которого больше всего параметров, которые он может удовлетворить; при неоднозначности — исключение. Лучше один конструктор (или primary constructor);</li>
<li><code>GetService</code> возвращает <code>null</code>, если сервис не зарегистрирован, <code>GetRequiredService</code> — бросает исключение. В коде почти всегда нужен второй.</li>
</ul>
<blockquote><strong>Важно.</strong> Вызов <code>serviceProvider.GetService</code> посреди бизнес-логики — это <strong>service locator</strong>, анти-паттерн: зависимости класса прячутся, тесты усложняются, ошибки регистрации всплывают в рантайме. Резолв вручную уместен в «корнях»: фабриках, middleware, фоновых сервисах, создающих scope.</blockquote>

<h3>Времена жизни</h3>
<p>Три lifetimes — самый частый вопрос по DI:</p>
<ul>
<li><strong>Singleton</strong> — один экземпляр на весь контейнер (то есть на всё приложение). Создаётся при первом запросе, живёт до остановки. Обязан быть <strong>потокобезопасным</strong>: его одновременно используют все запросы. Примеры: кэши, клиенты Kafka (<code>IProducer</code> рассчитан на переиспользование), <code>HttpClient</code> с настроенным handler’ом, конфигурация, <code>TimeProvider</code>.</li>
<li><strong>Scoped</strong> — один экземпляр на <strong>scope</strong>. В ASP.NET Core scope создаётся на каждый HTTP-запрос (<code>HttpContext.RequestServices</code>), поэтому scoped — это «один на запрос». Классика: <code>DbContext</code>, unit of work, контекст текущего пользователя или tenant’а. Вне HTTP scope создаёте вы сами.</li>
<li><strong>Transient</strong> — новый экземпляр при каждом резолве. Для лёгких stateless-сервисов. Если transient попросили три раза внутри одного запроса, будет три объекта.</li>
</ul>
<p>Выбор времени жизни — решение о <strong>состоянии</strong>. Нет состояния — подойдёт любое, чаще singleton или transient. Есть состояние, относящееся к запросу, — scoped. Есть общее состояние на всё приложение — singleton с синхронизацией. Отдельно стоит помнить о стоимости: transient с тяжёлым конструктором, внедрённый во множество мест, создаётся много раз.</p>
<pre><code>public sealed class RequestCounter            // хотим считать вызовы в пределах запроса
{
    public int Count { get; private set; }
    public void Hit() =&gt; Count++;
}

// Scoped: все сервисы одного запроса видят один счётчик
builder.Services.AddScoped&lt;RequestCounter&gt;();
// Transient: каждый сервис получит свой счётчик, итоговое число бессмысленно
// Singleton: счётчик общий для всех запросов, и ++ не атомарен — гонка</code></pre>

<h3>Captive dependency</h3>
<p><strong>Captive dependency</strong> («захваченная зависимость») — ситуация, когда сервис с длинным временем жизни держит ссылку на сервис с коротким. Самый опасный случай — scoped внутри singleton: singleton создаётся один раз, получает scoped-экземпляр из того scope, в котором его впервые резолвнули (или из корневого), и держит его вечно.</p>
<pre><code>public sealed class PriceCache(AppDbContext db) // зарегистрирован как Singleton
{
    public Task&lt;decimal&gt; GetAsync(Guid productId) =&gt;
        db.Prices.Where(p =&gt; p.ProductId == productId).Select(p =&gt; p.Amount).FirstAsync();
}

builder.Services.AddDbContext&lt;AppDbContext&gt;(...);  // Scoped
builder.Services.AddSingleton&lt;PriceCache&gt;();       // ← captive dependency</code></pre>
<p>Последствия: <code>DbContext</code> не потокобезопасен, и параллельные запросы получат <code>InvalidOperationException</code> «A second operation was started on this context»; change tracker копит сущности всех запросов — растёт память и возвращаются устаревшие данные; если контекст несёт tenant, данные одного клиента утекают к другому. Правило направления: зависимость должна жить <strong>не меньше</strong>, чем зависящий от неё сервис. Singleton может зависеть только от singleton; scoped — от scoped и singleton; transient — от чего угодно, но если transient внедрён в singleton, он сам становится фактически singleton’ом (это тоже captive, просто менее очевидный).</p>
<p>Как чинить: сделать потребителя scoped; или в singleton’е внедрить <code>IServiceScopeFactory</code> и создавать scope на операцию; или для EF Core использовать <code>IDbContextFactory&lt;T&gt;</code> и создавать короткоживущий контекст в каждом методе.</p>

<h3>Проверка scopes</h3>
<p>Контейнер умеет ловить captive dependency сам. <code>ServiceProviderOptions.ValidateScopes</code> запрещает резолвить scoped-сервис из корневого провайдера и внедрять его в singleton — будет исключение. <code>ValidateOnBuild</code> при построении контейнера проверяет, что все зарегистрированные сервисы вообще можно создать (все зависимости зарегистрированы). В <code>WebApplication</code> обе проверки <strong>включены в Development</strong> и выключены в остальных окружениях — ради скорости старта.</p>
<pre><code>// Включить везде (например, в интеграционных тестах или даже в проде, если старт не критичен)
builder.Host.UseDefaultServiceProvider(options =&gt;
{
    options.ValidateScopes = true;
    options.ValidateOnBuild = true;
});</code></pre>
<p>Отсюда важный практический вывод: если команда запускает локально что-то, кроме Development, или интеграционные тесты стартуют приложение в окружении Testing, проверки молча выключены, и captive dependency доедет до продакшена. Лучше включить их явно для тестов.</p>
<p>Вторая ловушка — резолв из <strong>корневого провайдера</strong>: <code>app.Services.GetRequiredService&lt;AppDbContext&gt;()</code> в <code>Program.cs</code>. С проверкой это исключение; без неё scoped-объект станет фактически singleton’ом корневого scope. Правильно — создать scope явно.</p>
<pre><code>await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService&lt;AppDbContext&gt;();
    await db.Database.MigrateAsync();   // только для dev; в проде — отдельный шаг деплоя
}</code></pre>

<h3>IServiceScopeFactory в singleton’ах и фоновых сервисах</h3>
<p><code>BackgroundService</code> и любые <code>IHostedService</code> — singleton’ы. HTTP-запроса нет, значит, и scope никто не создаёт. Если воркеру нужен <code>DbContext</code> или любой scoped-сервис, он создаёт scope сам — на <strong>единицу работы</strong>: на сообщение из Kafka, на батч, на итерацию цикла.</p>
<pre><code>public sealed class OutboxPublisher(IServiceScopeFactory scopeFactory, ILogger&lt;OutboxPublisher&gt; logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await using var scope = scopeFactory.CreateAsyncScope();   // свой scope на итерацию
            var db = scope.ServiceProvider.GetRequiredService&lt;AppDbContext&gt;();
            var publisher = scope.ServiceProvider.GetRequiredService&lt;IOutboxSender&gt;();

            var batch = await db.Outbox.Where(m =&gt; m.SentAt == null)
                                       .OrderBy(m =&gt; m.Id).Take(100).ToListAsync(stoppingToken);
            foreach (var message in batch)
                await publisher.SendAsync(message, stoppingToken);
            await db.SaveChangesAsync(stoppingToken);
        }
    }
}</code></pre>
<p>Почему scope на итерацию, а не один на весь срок жизни воркера: один долгоживущий <code>DbContext</code> накапливает отслеживаемые сущности, держит соединение и отдаёт устаревшие данные; после сбоя он может остаться в неконсистентном состоянии. Scope на итерацию даёт чистый контекст, а его dispose возвращает соединение в пул.</p>
<p><code>CreateAsyncScope</code> (с .NET 6) возвращает <code>AsyncServiceScope</code>, который корректно вызывает <code>DisposeAsync</code> у сервисов, реализующих только <code>IAsyncDisposable</code>. Если такой сервис окажется в обычном синхронном <code>using var scope = CreateScope()</code>, при dispose будет исключение.</p>
<blockquote><strong>Важно.</strong> <code>IServiceScopeFactory</code> сам по себе singleton, его можно внедрять куда угодно. А вот внедрять <code>IServiceProvider</code> из запроса в singleton нельзя: это провайдер scope, который будет уничтожен в конце запроса.</blockquote>

<h3>Keyed services</h3>
<p>До .NET 8 было неудобно иметь несколько реализаций одного интерфейса и выбирать конкретную: приходилось внедрять <code>IEnumerable&lt;T&gt;</code> и фильтровать, или писать свою фабрику по имени. В .NET 8 появились <strong>keyed services</strong> — регистрация с ключом:</p>
<pre><code>builder.Services.AddKeyedSingleton&lt;IStorage, S3Storage&gt;("s3");
builder.Services.AddKeyedSingleton&lt;IStorage, LocalStorage&gt;("local");

public sealed class MediaService([FromKeyedServices("s3")] IStorage storage) { ... }

// В minimal API — тот же атрибут на параметре
app.MapGet("/files/{id}", ([FromKeyedServices("local")] IStorage storage, string id) =&gt; ...);

// Вручную
var storage = sp.GetRequiredKeyedService&lt;IStorage&gt;("s3");</code></pre>
<p>Ключ — любой объект (строка, enum). Есть все три времени жизни: <code>AddKeyedScoped</code>, <code>AddKeyedTransient</code>. Регистрация с ключом не видна обычному <code>GetService&lt;IStorage&gt;()</code> — это отдельное пространство. Специальный ключ <code>KeyedService.AnyKey</code> позволяет зарегистрировать реализацию, которая отвечает на любой ключ.</p>
<p>Когда уместно: несколько клиентов к разным внешним системам одного интерфейса, стратегии по типу документа, разные хранилища. Когда не стоит: если ключ приходит из данных запроса (тип платежа из JSON), чаще чище явная фабрика или словарь стратегий — тогда выбор реализации остаётся в коде, а не размазан по атрибутам.</p>

<h3>Декораторы: Scrutor и ограничения встроенного контейнера</h3>
<p>Встроенный контейнер сознательно не умеет многого из того, что есть в Autofac или других контейнерах: перехват (interception), регистрацию по соглашениям (сканирование сборок), именованные регистрации до .NET 8, свойства-инъекции и <strong>декораторы</strong>. Декоратор — реализация того же интерфейса, оборачивающая исходную: кэширование, логирование, метрики, ретраи вокруг репозитория или клиента.</p>
<p>Вручную декоратор делается через фабрику:</p>
<pre><code>builder.Services.AddScoped&lt;ProductQueries&gt;();   // конкретный класс
builder.Services.AddScoped&lt;IProductQueries&gt;(sp =&gt;
    new CachingProductQueries(
        sp.GetRequiredService&lt;ProductQueries&gt;(),
        sp.GetRequiredService&lt;HybridCache&gt;()));</code></pre>
<p>Это работает, но при каждом новом параметре конструктора фабрику надо править. Библиотека <strong>Scrutor</strong> добавляет к <code>IServiceCollection</code> метод <code>Decorate</code> и сканирование сборок:</p>
<pre><code>builder.Services.AddScoped&lt;IProductQueries, ProductQueries&gt;();
builder.Services.Decorate&lt;IProductQueries, CachingProductQueries&gt;();   // оборачивает предыдущую регистрацию

builder.Services.Scan(scan =&gt; scan
    .FromAssemblyOf&lt;CreateOrderHandler&gt;()
    .AddClasses(c =&gt; c.AssignableTo(typeof(IValidator&lt;&gt;)))
    .AsImplementedInterfaces()
    .WithScopedLifetime());</code></pre>
<p><code>Decorate</code> заменяет существующую регистрацию: исходная реализация становится зависимостью декоратора, а время жизни берётся от исходной регистрации. Порядок вызовов определяет вложенность: последний <code>Decorate</code> — самый внешний слой. Нужно помнить, что <code>Decorate</code> бросает исключение, если декорируемый сервис ещё не зарегистрирован, — поэтому вызывайте его после основной регистрации.</p>
<p>Для MediatR похожую роль играют <strong>pipeline behaviors</strong> (<code>IPipelineBehavior&lt;TRequest, TResponse&gt;</code>) — это тоже декораторы, только вокруг обработчиков запросов: валидация через FluentValidation, транзакции, логирование. Выбирать стоит по месту: behavior — для правил, общих для всех команд; декоратор через Scrutor — для конкретного сервиса.</p>

<h3>Освобождение сервисов</h3>
<p>Контейнер вызывает <code>Dispose</code>/<code>DisposeAsync</code> у созданных <strong>им самим</strong> объектов, реализующих <code>IDisposable</code> или <code>IAsyncDisposable</code>:</p>
<ul>
<li>scoped и transient — при уничтожении scope, в котором они созданы (для HTTP — в конце запроса);</li>
<li>singleton — при уничтожении корневого провайдера, то есть при остановке приложения;</li>
<li>порядок — обратный порядку создания;</li>
<li>объекты, переданные готовым экземпляром (<code>AddSingleton(new Foo())</code>), контейнер <strong>не</strong> освобождает — он их не создавал. Объекты, созданные вашей фабрикой (<code>sp =&gt; new Foo()</code>), — освобождает.</li>
</ul>
<p>Классическая утечка — <strong>transient disposable, резолвленный из корневого провайдера</strong>: контейнер обязан его освободить, поэтому запоминает ссылку и держит её до остановки приложения. Если такой резолв происходит в цикле, память растёт без ограничений. То же произойдёт с transient-объектами в долгоживущем scope воркера, если scope не пересоздавать.</p>
<pre><code>// Утечка: каждый вызов создаёт объект, который корень держит до остановки
while (true)
{
    var conn = app.Services.GetRequiredService&lt;SomeDisposableTransient&gt;();
    ...
}</code></pre>
<p>И обратная ошибка — освобождать внедрённую зависимость вручную (<code>using</code> вокруг сервиса, полученного из конструктора). Владелец объекта — контейнер; сервис, сам вызвавший <code>Dispose</code> у своей зависимости, сломает всех остальных её потребителей в этом scope.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Расскажи про времена жизни сервисов и как выбираешь между ними»</summary>
<p>Singleton — один экземпляр на приложение, обязан быть потокобезопасным; scoped — один на scope, в вебе это один на HTTP-запрос; transient — новый на каждый резолв. Выбор определяется состоянием: состояние уровня запроса — <code>DbContext</code>, unit of work, текущий пользователь или tenant — это scoped. Общие разделяемые ресурсы — клиенты Kafka, кэши, <code>HttpClient</code>-handler’ы — singleton. Лёгкие stateless-сервисы — transient или singleton. Главное ограничение — зависимость не должна жить меньше потребителя, иначе captive dependency. Вне веба — в воркерах и консьюмерах — scope создаю сам через <code>IServiceScopeFactory</code> на единицу работы.</p>
</details>
<details><summary>«Что такое captive dependency и как её обнаружить?»</summary>
<p>Это когда долгоживущий сервис держит ссылку на короткоживущий: чаще всего scoped внутри singleton. Singleton создаётся один раз и навсегда захватывает тот экземпляр, который ему дали, — например, <code>DbContext</code>, который не потокобезопасен, копит отслеживаемые сущности и может нести данные чужого tenant’а. Обнаруживает её <code>ValidateScopes</code>: в Development он включён по умолчанию и бросит исключение при построении или резолве. Важно, что в других окружениях проверка выключена, поэтому в интеграционных тестах я включаю её явно. Чинится переводом потребителя в scoped, внедрением <code>IServiceScopeFactory</code> с созданием scope на операцию или <code>IDbContextFactory</code>. Transient внутри singleton — тоже captive, просто без исключения: transient фактически становится singleton’ом.</p>
</details>
<details><summary>«Как использовать DbContext внутри BackgroundService?»</summary>
<p><code>BackgroundService</code> — singleton, поэтому внедрять <code>DbContext</code> в конструктор нельзя. Внедряю <code>IServiceScopeFactory</code> и на каждую единицу работы — сообщение, батч, тик таймера — создаю <code>CreateAsyncScope</code>, беру из него контекст и нужные сервисы. Scope на итерацию, а не на весь срок жизни воркера: иначе change tracker растёт, данные устаревают, а после ошибки контекст может остаться в плохом состоянии. <code>CreateAsyncScope</code> нужен, чтобы корректно освободить сервисы с <code>IAsyncDisposable</code>. Альтернатива для EF — <code>IDbContextFactory</code>, он регистрируется как singleton и создаёт контексты по требованию.</p>
</details>
<details><summary>«Что вернёт контейнер, если интерфейс зарегистрирован дважды?»</summary>
<p>При резолве одного экземпляра — последнюю регистрацию. При резолве <code>IEnumerable&lt;T&gt;</code> — все реализации в порядке регистрации. Этим пользуются для наборов обработчиков и валидаторов, а библиотеки — для переопределяемых значений по умолчанию через <code>TryAdd</code>, который добавляет регистрацию, только если её ещё нет. <code>TryAddEnumerable</code> защищает от двойного добавления одной реализации в набор. Если нужно выбрать конкретную реализацию по ключу, с .NET 8 есть keyed services с <code>[FromKeyedServices]</code>.</p>
</details>
<details><summary>«Как сделать декоратор во встроенном контейнере?»</summary>
<p>Встроенный контейнер декораторы не поддерживает. Вручную — регистрирую конкретную реализацию как класс, а интерфейс — фабрикой, которая создаёт декоратор и передаёт ему исходную реализацию из контейнера. Это работает, но фабрику надо поддерживать при изменении конструктора. Поэтому обычно беру Scrutor: <code>Decorate&lt;IService, CachingService&gt;()</code> подменяет существующую регистрацию, сохраняя её время жизни, а последний вызов становится внешним слоем. Для сквозных правил вокруг всех команд в MediatR правильнее pipeline behavior, это тоже декоратор, но обобщённый.</p>
</details>
<details><summary>«Кто и когда освобождает сервисы? Где можно получить утечку?»</summary>
<p>Контейнер освобождает то, что создал сам: scoped и transient — при уничтожении их scope, singleton — при остановке приложения, в обратном порядке создания. Готовые экземпляры, переданные в <code>AddSingleton(instance)</code>, он не трогает. Утечка возникает, когда disposable transient резолвят из корневого провайдера: корень обязан его освободить, поэтому держит ссылку до остановки, и в цикле это неограниченный рост памяти. То же — в долгоживущем scope воркера. И обратная ошибка — вызывать <code>Dispose</code> у внедрённой зависимости вручную: владелец — контейнер, и другие потребители в том же scope получат освобождённый объект.</p>
</details>
<details><summary>«Чем keyed services лучше IEnumerable или фабрики?»</summary>
<p>Keyed services из .NET 8 позволяют зарегистрировать несколько реализаций одного интерфейса под ключами и получить нужную через <code>[FromKeyedServices("key")]</code> в конструкторе или параметре minimal API, либо <code>GetRequiredKeyedService</code>. Это убирает самописные фабрики по имени и фильтрацию <code>IEnumerable</code>. Но если ключ определяется данными запроса, например типом документа, я бы оставил явную фабрику или словарь стратегий: выбор тогда виден в коде и тестируется, а не держится на строковых ключах. Keyed хорошо подходит для статического выбора на этапе композиции: два хранилища, два клиента к разным системам.</p>
</details>`},

    { id: 'api', title: 'Controllers и Minimal APIs', html: `<h3>Контроллеры и [ApiController]</h3>
<p>В ASP.NET Core есть два способа описать HTTP-эндпоинты: <strong>контроллеры</strong> (MVC, классы с действиями) и <strong>Minimal APIs</strong> (лямбды или методы, зарегистрированные через <code>MapGet</code>/<code>MapPost</code>). Оба работают поверх одной системы маршрутизации, одного model binding’а для простых случаев и одной авторизации. Выбор — вопрос структуры и возможностей, а не «старое против нового».</p>
<p>Атрибут <code>[ApiController]</code> включает поведение, ожидаемое от JSON API:</p>
<ul>
<li><strong>обязательная attribute routing</strong> — маршрут задаётся атрибутами <code>[Route]</code>, <code>[HttpGet]</code>;</li>
<li><strong>автоматический ответ 400</strong>: если <code>ModelState</code> невалиден после биндинга, действие не вызывается, клиент получает <code>ValidationProblemDetails</code> со словарём ошибок по полям;</li>
<li><strong>вывод источников привязки</strong>: сложный тип — из тела, параметр с именем из шаблона маршрута — из маршрута, остальные простые — из query, зарегистрированные в DI сервисы — из контейнера, <code>IFormFile</code> — из формы;</li>
<li><strong>ProblemDetails для кодов ошибок</strong>: <code>return NotFound()</code> превращается в тело <code>application/problem+json</code>.</li>
</ul>
<pre><code>[ApiController]
[Route("v1/orders")]
public sealed class OrdersController(ISender mediator) : ControllerBase
{
    [HttpGet("{id:guid}")]
    [ProducesResponseType&lt;OrderDto&gt;(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task&lt;IActionResult&gt; Get(Guid id, CancellationToken ct)
    {
        var order = await mediator.Send(new GetOrderQuery(id), ct);
        return order is null ? NotFound() : Ok(order);
    }

    [HttpPost]
    public async Task&lt;ActionResult&lt;OrderDto&gt;&gt; Create(CreateOrderRequest request, CancellationToken ct)
    {
        var created = await mediator.Send(new CreateOrderCommand(request), ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }
}</code></pre>
<p>Для API наследуются от <code>ControllerBase</code>, а не <code>Controller</code>: последний добавляет поддержку представлений (View, ViewBag), которая в API не нужна. <code>CancellationToken</code> в параметре действия привязывается к <code>HttpContext.RequestAborted</code> — его стоит прокидывать во все асинхронные вызовы, чтобы оборванный клиентом запрос не продолжал нагружать базу.</p>

<h3>Model binding</h3>
<p>Model binding превращает части HTTP-запроса в параметры действия. Источники: маршрут (<code>[FromRoute]</code>), строка запроса (<code>[FromQuery]</code>), заголовки (<code>[FromHeader]</code>), тело (<code>[FromBody]</code>), форма (<code>[FromForm]</code>), DI (<code>[FromServices]</code>), а с .NET 8 ещё и <code>[FromKeyedServices]</code>. Тело запроса читается <strong>один раз</strong> потоком, поэтому параметр <code>[FromBody]</code> может быть только один — остальное сводят в один DTO.</p>
<p>В Minimal APIs правила похожие, но вывод источников свой:</p>
<ul>
<li>параметр с именем из шаблона маршрута — из маршрута;</li>
<li>простые типы (у которых есть <code>TryParse</code>) — из query;</li>
<li>сложные типы — из JSON-тела (для GET это ошибка, а не пустой объект);</li>
<li>зарегистрированные в DI сервисы — из контейнера;</li>
<li>специальные типы — <code>HttpContext</code>, <code>HttpRequest</code>, <code>CancellationToken</code>, <code>ClaimsPrincipal</code> — подставляются напрямую;</li>
<li><code>[AsParameters]</code> позволяет собрать несколько параметров в один record — удобно для фильтров списков.</li>
</ul>
<pre><code>public sealed record OrderListQuery(
    [FromQuery] int Page = 1,
    [FromQuery] int PageSize = 20,
    [FromQuery] string? Search = null,
    [FromHeader(Name = "x-organization-uuid")] Guid OrganizationId = default);

app.MapGet("/v1/orders", async ([AsParameters] OrderListQuery query, ISender mediator, CancellationToken ct) =&gt;
    TypedResults.Ok(await mediator.Send(new ListOrdersQuery(query), ct)));</code></pre>
<p>Свои типы для маршрута и query делаются статическим методом <code>TryParse</code> (например, value object <code>OrderNumber</code>), а полностью свой способ привязки — статическим <code>BindAsync(HttpContext, ParameterInfo)</code>. JSON-тело десериализуется <code>System.Text.Json</code>; его настройки (camelCase, enum как строки) задаются через <code>ConfigureHttpJsonOptions</code> для Minimal APIs и <code>AddControllers().AddJsonOptions</code> для контроллеров — это две разные настройки, и забыть одну из них — частая причина «в контроллерах enum строкой, в minimal API — числом».</p>
<blockquote><strong>Важно.</strong> Over-posting: если биндить запрос прямо в сущность EF, клиент может прислать поле <code>IsAdmin</code> или <code>OrganizationId</code>, которое вы не собирались принимать. Всегда принимайте отдельный DTO запроса с ровно теми полями, которые разрешено менять.</blockquote>

<h3>Валидация</h3>
<p>Встроенная валидация в MVC основана на DataAnnotations: атрибуты <code>[Required]</code>, <code>[Range]</code>, <code>[StringLength]</code> на свойствах DTO, интерфейс <code>IValidatableObject</code> для правил между полями. После биндинга результат лежит в <code>ModelState</code>, и с <code>[ApiController]</code> невалидная модель автоматически даёт 400 с <code>ValidationProblemDetails</code>:</p>
<pre><code>{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": { "Quantity": ["The field Quantity must be between 1 and 1000."] }
}</code></pre>
<p>В реальных проектах чаще используют <strong>FluentValidation</strong>: правила пишутся кодом в отдельном классе <code>AbstractValidator&lt;T&gt;</code>, легко тестируются, поддерживают асинхронные проверки и условные правила. Встроить его можно тремя путями: вызывать валидатор вручную в обработчике; подключить авто-валидацию в MVC (сам FluentValidation от неё отказался в пользу ручного вызова, а для автоматики есть сторонний пакет SharpGrip.FluentValidation.AutoValidation); или — особенно с MediatR — сделать pipeline behavior, который валидирует каждую команду перед обработчиком.</p>
<pre><code>public sealed class CreateOrderValidator : AbstractValidator&lt;CreateOrderCommand&gt;
{
    public CreateOrderValidator()
    {
        RuleFor(x =&gt; x.CounterpartyId).NotEmpty();
        RuleForEach(x =&gt; x.Lines).ChildRules(line =&gt;
        {
            line.RuleFor(l =&gt; l.Quantity).InclusiveBetween(1, 1000);
        });
    }
}

public sealed class ValidationBehavior&lt;TRequest, TResponse&gt;(IEnumerable&lt;IValidator&lt;TRequest&gt;&gt; validators)
    : IPipelineBehavior&lt;TRequest, TResponse&gt; where TRequest : notnull
{
    public async Task&lt;TResponse&gt; Handle(TRequest request, RequestHandlerDelegate&lt;TResponse&gt; next, CancellationToken ct)
    {
        var failures = (await Task.WhenAll(validators.Select(v =&gt; v.ValidateAsync(request, ct))))
            .SelectMany(r =&gt; r.Errors).ToList();
        if (failures.Count &gt; 0) throw new ValidationException(failures);
        return await next();
    }
}</code></pre>
<p>Для Minimal APIs исторически встроенной валидации не было — её делали endpoint filter’ом. В .NET 10 появилась встроенная поддержка DataAnnotations-валидации для Minimal APIs (подключается через <code>builder.Services.AddValidation()</code>). Разделяйте два уровня: <strong>валидация формы запроса</strong> (поля заполнены, числа в диапазоне) — на входе, 400; <strong>бизнес-правила</strong> (нельзя отменить выданный заказ, товар закончился) — в домене или обработчике, обычно 409 или 422 с собственным кодом ошибки.</p>

<h3>Фильтры MVC и их порядок</h3>
<p>Фильтры — это middleware внутри MVC: они выполняются вокруг конкретного действия и имеют доступ к его контексту (аргументы, <code>ModelState</code>, результат). Типы фильтров по порядку выполнения:</p>
<ol>
<li><strong>Authorization filters</strong> — первыми; решают, допущен ли пользователь (на практике авторизацию делают политиками, а не своими фильтрами);</li>
<li><strong>Resource filters</strong> — оборачивают всё остальное, включая model binding; подходят для кэширования или раннего отказа до биндинга;</li>
<li><em>model binding и валидация</em>;</li>
<li><strong>Action filters</strong> — до и после вызова метода действия, видят аргументы и могут подменить результат;</li>
<li><em>метод действия</em>;</li>
<li><strong>Exception filters</strong> — обрабатывают необработанные исключения из создания контроллера, model binding, action filters и самого действия;</li>
<li><strong>Result filters</strong> — до и после выполнения результата (сериализации ответа), только если результат будет выполнен.</li>
</ol>
<blockquote><strong>Важно.</strong> Exception filters <strong>не</strong> ловят исключения из resource filters, result filters и выполнения результата (сериализации). Поэтому глобальную обработку ошибок делают middleware (<code>UseExceptionHandler</code>), а не exception filter’ом: middleware видит всё.</blockquote>
<p>Порядок внутри одного типа определяется областью: <strong>глобальные → контроллер → действие</strong> для кода «до», и обратный для кода «после» — та же луковица. Свойство <code>Order</code> (<code>IOrderedFilter</code>) меняет этот порядок: меньшее значение выполняется раньше.</p>
<pre><code>public sealed class RequireTenantFilter(ITenantContext tenant) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (tenant.Id is null)
        {
            context.Result = new NotFoundResult();   // short-circuit: действие не вызовется
            return;
        }
        await next();                                // выполнить действие и последующие фильтры
    }
}

builder.Services.AddScoped&lt;RequireTenantFilter&gt;();
builder.Services.AddControllers(o =&gt; o.Filters.Add&lt;RequireTenantFilter&gt;());  // глобально

// или точечно:
[ServiceFilter(typeof(RequireTenantFilter))]   // берёт из DI, нужна регистрация
[TypeFilter(typeof(AuditFilter))]              // создаёт через ActivatorUtilities, регистрация не нужна</code></pre>
<p>Атрибут-фильтр, наследующий <code>ActionFilterAttribute</code>, не может получить зависимости через конструктор (атрибуты создаются рефлексией с константными аргументами) — для этого и существуют <code>ServiceFilter</code>, <code>TypeFilter</code> или <code>IFilterFactory</code>.</p>

<h3>Minimal APIs</h3>
<p>Minimal APIs — эндпоинты без контроллеров: меньше церемоний, меньше накладных расходов, поддержка Native AOT через source generator делегатов. Начиная с .NET 7 у них есть всё нужное для больших проектов: группы маршрутов, endpoint filters, типизированные результаты.</p>
<pre><code>var orders = app.MapGroup("/v1/orders")
    .RequireAuthorization()
    .WithTags("Orders")
    .AddEndpointFilter&lt;TenantFilter&gt;();

orders.MapGet("/{id:guid}", GetOrder).WithName("GetOrder");
orders.MapPost("/", CreateOrder);

static async Task&lt;Results&lt;Ok&lt;OrderDto&gt;, NotFound&gt;&gt; GetOrder(Guid id, ISender mediator, CancellationToken ct)
{
    var order = await mediator.Send(new GetOrderQuery(id), ct);
    return order is null ? TypedResults.NotFound() : TypedResults.Ok(order);
}

static async Task&lt;Created&lt;OrderDto&gt;&gt; CreateOrder(CreateOrderRequest request, ISender mediator, CancellationToken ct)
{
    var created = await mediator.Send(new CreateOrderCommand(request), ct);
    return TypedResults.Created($"/v1/orders/{created.Id}", created);
}</code></pre>
<p><code>TypedResults</code> вместо <code>Results</code> и возвращаемый тип <code>Results&lt;Ok&lt;T&gt;, NotFound&gt;</code> дают две вещи: компилятор проверяет, что метод возвращает только объявленные варианты, а генератор OpenAPI сам узнаёт все возможные ответы без атрибутов. Именованные методы вместо лямбд легче тестировать: результат — обычный объект, его можно проверить без HTTP.</p>
<p><strong>Endpoint filters</strong> (<code>IEndpointFilter</code>) — аналог action filters для Minimal APIs. Они получают <code>EndpointFilterInvocationContext</code> с аргументами обработчика и могут вернуть результат, не вызывая следующий фильтр:</p>
<pre><code>public sealed class ValidationFilter&lt;T&gt;(IValidator&lt;T&gt; validator) : IEndpointFilter
{
    public async ValueTask&lt;object?&gt; InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var argument = context.Arguments.OfType&lt;T&gt;().FirstOrDefault();
        if (argument is null) return await next(context);

        var result = await validator.ValidateAsync(argument);
        return result.IsValid
            ? await next(context)
            : TypedResults.ValidationProblem(result.ToDictionary());
    }
}</code></pre>
<p>Когда что выбирать. Контроллеры — если команда привыкла к ним, нужны богатые MVC-фильтры, конвенции, model binding форм. Minimal APIs — для новых сервисов, особенно маленьких микросервисов, AOT, и когда хочется явной регистрации без «магии» сканирования. Смешивать в одном приложении можно.</p>

<h3>ProblemDetails и RFC 9457</h3>
<p>Единый формат ошибок — признак зрелого API. Стандарт — <strong>Problem Details for HTTP APIs</strong>: RFC 7807 (2016), заменённый в 2023 году на <strong>RFC 9457</strong> с совместимым форматом. Content-Type — <code>application/problem+json</code>, стандартные поля:</p>
<ul>
<li><code>type</code> — URI, идентифицирующий тип проблемы (по умолчанию <code>about:blank</code>);</li>
<li><code>title</code> — краткое человекочитаемое описание типа, одинаковое для всех случаев этого типа;</li>
<li><code>status</code> — HTTP-статус;</li>
<li><code>detail</code> — описание конкретного случая;</li>
<li><code>instance</code> — URI конкретного случая;</li>
<li>плюс любые <strong>extension members</strong>: <code>traceId</code>, <code>errors</code>, ваш машиночитаемый <code>code</code>, аргументы ошибки.</li>
</ul>
<p>В ASP.NET Core <code>builder.Services.AddProblemDetails()</code> регистрирует <code>IProblemDetailsService</code>, и его начинают использовать обработчик исключений, middleware кодов состояния (<code>UseStatusCodePages</code>) и страница ошибок разработчика. Через <code>CustomizeProblemDetails</code> можно добавить поля во все ответы сразу:</p>
<pre><code>builder.Services.AddProblemDetails(options =&gt;
{
    options.CustomizeProblemDetails = ctx =&gt;
    {
        ctx.ProblemDetails.Instance = $"{ctx.HttpContext.Request.Method} {ctx.HttpContext.Request.Path}";
        ctx.ProblemDetails.Extensions["traceId"] = Activity.Current?.Id ?? ctx.HttpContext.TraceIdentifier;
    };
});</code></pre>
<p>Совет из практики: клиенту нужен стабильный <strong>машиночитаемый код</strong> ошибки (<code>"code": "OrderNotEditable"</code>) и аргументы, а не только текст. Текст можно локализовать и менять, код — контракт. Тогда фронтенд сам решает, как показать ошибку, а <code>detail</code> служит запасным вариантом.</p>

<h3>Глобальная обработка ошибок: IExceptionHandler</h3>
<p>Необработанное исключение не должно уходить клиенту стектрейсом или пустым 500. Базовый механизм — <code>UseExceptionHandler</code>: middleware в начале конвейера ловит исключение, логирует его и повторно выполняет конвейер для формирования ответа об ошибке. С .NET 8 появился интерфейс <code>IExceptionHandler</code> — это удобный способ написать логику превращения исключения в ответ:</p>
<pre><code>public sealed class DomainExceptionHandler(IProblemDetailsService problemDetails, ILogger&lt;DomainExceptionHandler&gt; logger)
    : IExceptionHandler
{
    public async ValueTask&lt;bool&gt; TryHandleAsync(HttpContext context, Exception exception, CancellationToken ct)
    {
        if (exception is not DomainException domain)
            return false;                              // не моё — пусть обработает следующий

        logger.LogWarning(exception, "Domain rule violated: {Code}", domain.Code);
        context.Response.StatusCode = StatusCodes.Status409Conflict;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            Exception = exception,
            ProblemDetails = { Title = "Conflict", Detail = domain.Message, Extensions = { ["code"] = domain.Code } }
        });
    }
}

builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler&lt;DomainExceptionHandler&gt;();   // можно несколько, вызываются по порядку регистрации
var app = builder.Build();
app.UseExceptionHandler();                                         // первым в конвейере</code></pre>
<p>Обработчики вызываются в порядке регистрации, пока один не вернёт <code>true</code>. Если никто не обработал, срабатывает стандартный ответ 500 в формате ProblemDetails. Обработчик регистрируется как singleton, так что scoped-зависимости в него не внедряют.</p>
<p>Архитектурный вопрос, который часто поднимают: <strong>исключения или Result</strong>. Исключения для ожидаемых бизнес-ситуаций («заказ не найден», «недостаточно товара») дороги и делают поток управления неявным. Многие команды возвращают из обработчиков <code>Result&lt;T&gt;</code> с кодом ошибки, а на границе API маппят его в ProblemDetails; исключения остаются для действительно неожиданного (база недоступна, баг). Глобальный обработчик при этом всё равно нужен — для второго класса.</p>
<blockquote><strong>Важно.</strong> Ставьте <code>UseExceptionHandler</code> первым (после forwarded headers). В Production ответ не должен содержать текст исключения и стектрейс: детали — в лог, клиенту — <code>traceId</code>, по которому этот лог можно найти.</blockquote>

<h3>Версионирование API</h3>
<p>Публичный контракт API меняется, а клиенты обновляются не одновременно: мобильное приложение старой версии живёт месяцами. Ломающие изменения (удалили поле, сменили тип, изменили смысл) требуют новой версии; добавление необязательного поля в ответ — обычно не требует, если клиенты устойчивы к неизвестным полям.</p>
<p>Стандартная библиотека — <strong>Asp.Versioning</strong> (наследник <code>Microsoft.AspNetCore.Mvc.Versioning</code>): пакеты <code>Asp.Versioning.Mvc</code> для контроллеров, <code>Asp.Versioning.Http</code> для Minimal APIs и <code>Asp.Versioning.Mvc.ApiExplorer</code> для интеграции с OpenAPI. Способы передать версию: сегмент URL (<code>/v2/orders</code>), query string (<code>?api-version=2.0</code>), заголовок, media type.</p>
<pre><code>builder.Services.AddApiVersioning(options =&gt;
{
    options.DefaultApiVersion = new ApiVersion(1, 0);
    options.AssumeDefaultVersionWhenUnspecified = true;
    options.ReportApiVersions = true;                 // заголовки api-supported-versions / api-deprecated-versions
    options.ApiVersionReader = new UrlSegmentApiVersionReader();
}).AddMvc();

[ApiController]
[ApiVersion("1.0", Deprecated = true)]
[ApiVersion("2.0")]
[Route("v{version:apiVersion}/orders")]
public sealed class OrdersController : ControllerBase
{
    [HttpGet("{id:guid}"), MapToApiVersion("1.0")] public IActionResult GetV1(Guid id) =&gt; ...;
    [HttpGet("{id:guid}"), MapToApiVersion("2.0")] public IActionResult GetV2(Guid id) =&gt; ...;
}</code></pre>
<p>Версия в URL — самая явная и удобная для кэширования, логов и ручного тестирования; заголовок — «чище» с точки зрения REST, но его легко забыть. Для внутренних API между микросервисами часто обходятся без версий вовсе, договариваясь об обратной совместимости (expand–contract: сначала добавить новое, перевести потребителей, потом удалить старое). Именно так обычно эволюционируют и контракты в Kafka и gRPC.</p>

<h3>OpenAPI</h3>
<p>OpenAPI-документ описывает эндпоинты, параметры, схемы и коды ответов; по нему генерируют клиенты (NSwag, Kiota, openapi-typescript, Hey API) и рисуют интерактивную документацию. Долгое время стандартом был <strong>Swashbuckle</strong> (<code>AddSwaggerGen</code>, <code>UseSwagger</code>, <code>UseSwaggerUI</code>). Начиная с <strong>.NET 9</strong> в ASP.NET Core есть встроенная генерация — пакет <code>Microsoft.AspNetCore.OpenApi</code>, а Swashbuckle убран из стандартных шаблонов.</p>
<pre><code>builder.Services.AddOpenApi(options =&gt;
{
    options.AddDocumentTransformer((document, context, ct) =&gt;
    {
        document.Info.Title = "Warehouse API";
        return Task.CompletedTask;
    });
    options.AddOperationTransformer&lt;PermissionOperationTransformer&gt;(); // свой x-атрибут в каждую операцию
});

var app = builder.Build();
app.MapOpenApi();          // документ по адресу /openapi/v1.json</code></pre>
<p>Встроенный генератор отдаёт только документ — UI в него не входит; для просмотра подключают отдельно Scalar или Swagger UI. Настройка делается <strong>transformers</strong>: документа, операции и схемы. Документ строится из метаданных эндпоинтов: <code>ProducesResponseType</code>, <code>TypedResults</code>, <code>WithName</code>, <code>WithTags</code>, XML-комментарии. В .NET 10 по умолчанию генерируется OpenAPI 3.1.</p>
<p>Практические советы: опишите все коды ответов, включая ProblemDetails для 4xx; давайте операциям стабильные имена (<code>operationId</code>) — от них зависят имена методов сгенерированного клиента; документ можно генерировать на этапе сборки и проверять в CI, что контракт не сломался неожиданно. Публиковать документ и UI в продакшене или нет — решение безопасности: часто их держат только во внутренних окружениях.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Что делает атрибут [ApiController]?»</summary>
<p>Он включает поведение для JSON API. Обязательна attribute routing. Невалидный <code>ModelState</code> после биндинга автоматически даёт 400 с <code>ValidationProblemDetails</code>, и действие даже не вызывается — поэтому ручные проверки <code>if (!ModelState.IsValid)</code> не нужны. Источники параметров выводятся: сложный тип из тела, параметры из шаблона маршрута — из маршрута, остальные простые — из query, сервисы — из DI. И ответы с кодами ошибок вроде <code>NotFound()</code> оформляются как ProblemDetails. Автоматический 400 можно отключить через <code>SuppressModelStateInvalidFilter</code>, если валидация делается иначе, например FluentValidation в pipeline MediatR.</p>
</details>
<details><summary>«Перечисли типы фильтров MVC и порядок их выполнения»</summary>
<p>Authorization filters, затем resource filters, которые оборачивают даже model binding, затем биндинг и валидация, action filters до и после действия, само действие, exception filters для исключений из действия, биндинга и action filters, и result filters вокруг выполнения результата. Внутри типа порядок — глобальные, контроллер, действие для кода «до» и обратный для «после»; <code>Order</code> его переопределяет. Важная деталь: exception filters не ловят исключения из resource и result filters и из сериализации ответа, поэтому глобальную обработку ошибок я делаю через <code>UseExceptionHandler</code> и <code>IExceptionHandler</code>. Фильтру с зависимостями нужен <code>ServiceFilter</code> или <code>TypeFilter</code>, потому что атрибут не получает зависимости через конструктор.</p>
</details>
<details><summary>«Контроллеры или Minimal APIs — что выберешь для нового сервиса?»</summary>
<p>Для нового микросервиса скорее Minimal APIs: меньше накладных расходов и церемоний, явная регистрация эндпоинтов, <code>MapGroup</code> для общих префиксов и политик, endpoint filters, <code>TypedResults</code> с проверкой типов и автоматическими метаданными для OpenAPI, поддержка Native AOT. Контроллеры оставлю, если команда на них стандартизирована, нужны MVC-фильтры, конвенции или сложный model binding форм. Принципиальной разницы в возможностях после .NET 7–8 почти нет, обе модели — эндпоинты одной маршрутизации с одной авторизацией. Важнее единый стиль внутри сервиса и тонкие эндпоинты, делегирующие работу обработчикам.</p>
</details>
<details><summary>«Как у тебя устроена глобальная обработка ошибок?»</summary>
<p><code>AddProblemDetails</code> плюс один или несколько <code>IExceptionHandler</code> и <code>UseExceptionHandler</code> первым в конвейере. Каждый обработчик отвечает за свой класс исключений и возвращает <code>true</code>, если обработал; остальное становится стандартным 500 в формате ProblemDetails. Через <code>CustomizeProblemDetails</code> во все ответы добавляется <code>traceId</code>, чтобы по нему найти лог. Ожидаемые бизнес-ошибки я стараюсь не бросать, а возвращать как <code>Result</code> с кодом и маппить в ProblemDetails на границе — там стабильный машиночитаемый <code>code</code>, аргументы и локализованный <code>detail</code>. Исключения — для неожиданного. В Production клиенту не отдаются ни текст исключения, ни стектрейс.</p>
</details>
<details><summary>«Что такое ProblemDetails и какие поля в нём есть?»</summary>
<p>Это стандартный формат тела ошибки HTTP API, описанный в RFC 7807, а с 2023 года — в заменившем его RFC 9457, формат совместим. Content-Type <code>application/problem+json</code>, поля <code>type</code> — URI типа проблемы, <code>title</code> — описание типа, <code>status</code>, <code>detail</code> — описание конкретного случая, <code>instance</code> — идентификатор случая. Плюс произвольные extensions: <code>errors</code> у ошибок валидации, <code>traceId</code>, собственный код ошибки и аргументы. Смысл — клиенты обрабатывают все ошибки одинаково, а не разбирают пять разных форматов от разных команд.</p>
</details>
<details><summary>«Как версионировать API и когда это вообще нужно?»</summary>
<p>Новая версия нужна при ломающих изменениях: удаление или переименование поля, смена типа или смысла. Добавление необязательного поля обычно совместимо. Для публичных API беру Asp.Versioning с версией в сегменте URL — явно, видно в логах, хорошо кэшируется; старую версию помечаю <code>Deprecated</code>, и <code>ReportApiVersions</code> отдаёт это клиенту в заголовках. Для внутренних API между своими сервисами предпочитаю обходиться без версий и эволюционировать по схеме expand–contract: добавить новое, перевести потребителей, затем удалить старое. Так же меняют схемы сообщений в Kafka и protobuf-контракты.</p>
</details>
<details><summary>«Swashbuckle или встроенный OpenAPI?»</summary>
<p>С .NET 9 есть встроенный <code>Microsoft.AspNetCore.OpenApi</code>: <code>AddOpenApi</code> и <code>MapOpenApi</code>, документ по <code>/openapi/v1.json</code>, настройка через document, operation и schema transformers; в .NET 10 по умолчанию OpenAPI 3.1. Swashbuckle убран из шаблонов, но продолжает существовать. Для нового проекта беру встроенный: он развивается вместе с фреймворком и понимает метаданные minimal APIs и <code>TypedResults</code>. UI во встроенный не входит, подключаю Scalar или Swagger UI. На существующем проекте с большим количеством кастомных фильтров Swashbuckle миграция — отдельная задача, которую оцениваю по объёму кастомизаций.</p>
</details>
<details><summary>«Почему в minimal API enum приходит числом, а в контроллерах строкой?»</summary>
<p>Потому что у них разные настройки JSON: контроллеры берут опции из <code>AddControllers().AddJsonOptions(...)</code>, а Minimal APIs — из <code>ConfigureHttpJsonOptions</code>, который настраивает <code>Microsoft.AspNetCore.Http.Json.JsonOptions</code>. Если конвертер <code>JsonStringEnumConverter</code> добавлен только в одно место, получится расхождение. Решение — настроить оба, лучше одним общим методом, а в OpenAPI убедиться, что схема enum описана так же, как реально сериализуется. Это тот случай, когда интеграционный тест на реальный HTTP-ответ ловит то, что юнит-тест обработчика не увидит.</p>
</details>`},

    { id: 'auth', title: 'Аутентификация и авторизация', html: `<h3>Термины и схемы аутентификации</h3>
<p><strong>Аутентификация</strong> отвечает на вопрос «кто это?»: по запросу (cookie, заголовку <code>Authorization</code>, клиентскому сертификату) строится <code>ClaimsPrincipal</code> — набор утверждений (claims) о пользователе. <strong>Авторизация</strong> отвечает на вопрос «можно ли ему это?» на основе этих claims, политик и, возможно, самого ресурса. В ASP.NET Core это два разных middleware и две разные подсистемы.</p>
<p>Аутентификация построена на <strong>схемах</strong>. Схема — это имя плюс обработчик (<code>AuthenticationHandler</code>), который умеет три действия:</p>
<ul>
<li><strong>Authenticate</strong> — попытаться построить пользователя из запроса; результат — успех, провал или «нет данных» (NoResult);</li>
<li><strong>Challenge</strong> — что делать, если требуется аутентифицированный пользователь, а его нет: JWT bearer отвечает <strong>401</strong> с заголовком <code>WWW-Authenticate</code>, cookie-схема — редиректом на страницу входа, OIDC — редиректом на IdP;</li>
<li><strong>Forbid</strong> — пользователь известен, но прав нет: bearer отвечает <strong>403</strong>, cookie — редиректом на AccessDenied.</li>
</ul>
<pre><code>builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)   // схема по умолчанию
    .AddJwtBearer(options =&gt; { /* см. ниже */ })
    .AddJwtBearer("internal", options =&gt; { /* токены межсервисного IdP */ });

var app = builder.Build();
app.UseAuthentication();    // заполняет HttpContext.User схемой по умолчанию
app.UseAuthorization();</code></pre>
<p><code>UseAuthentication</code> вызывает Authenticate у схемы по умолчанию и кладёт результат в <code>HttpContext.User</code>. Если аутентификация не удалась, запрос не отклоняется — пользователь просто анонимный. Отклоняет уже авторизация: эндпоинту с <code>[Authorize]</code> нужен аутентифицированный пользователь, и при его отсутствии вызывается Challenge (401). Это важный момент: невалидный токен на эндпоинте с <code>[AllowAnonymous]</code> не даст ошибку.</p>
<p>Несколько схем полезны, когда к одному API ходят и пользователи, и сервисы с токенами другого издателя. Политика может явно указать схемы: <code>policy.AddAuthenticationSchemes("internal")</code>; есть и policy schemes с <code>ForwardDefaultSelector</code>, которые выбирают схему по запросу.</p>
<blockquote><strong>Важно.</strong> 401 означает «я не знаю, кто вы» (нет или невалиден токен), 403 — «знаю, но нельзя». Путать их — частая ошибка: клиент на 401 пытается обновить токен и войти заново, а на 403 — нет.</blockquote>

<h3>JWT bearer: что именно проверяется</h3>
<p>JWT (JSON Web Token) — три части в base64url: header (алгоритм, <code>kid</code> — идентификатор ключа), payload (claims) и подпись. API не ходит в IdP на каждый запрос: оно проверяет подпись токена публичным ключом и содержимое claims. Это и плюс (быстро, масштабируется), и минус (выданный токен нельзя отозвать до истечения).</p>
<pre><code>builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =&gt;
    {
        options.Authority = "https://sso.example.com/realms/polestar"; // откуда брать метаданные и ключи
        options.Audience = "backend";                                  // для кого выпущен токен
        options.MapInboundClaims = false;                              // не переименовывать sub, email и т.д.
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,          // iss совпадает с ожидаемым издателем
            ValidateAudience = true,        // aud содержит наш API
            ValidateLifetime = true,        // exp и nbf
            ValidateIssuerSigningKey = true,
            ClockSkew = TimeSpan.FromSeconds(30),   // по умолчанию 5 минут
            NameClaimType = "preferred_username",
            RoleClaimType = "role",
        };
    });</code></pre>
<p>По шагам, что делает обработчик:</p>
<ol>
<li>Достаёт токен из заголовка <code>Authorization: Bearer ...</code> (событие <code>OnMessageReceived</code> позволяет взять его из другого места — например, из query для WebSocket/SignalR).</li>
<li>По <code>Authority</code> загружает OIDC discovery-документ (<code>/.well-known/openid-configuration</code>), а из него — <code>jwks_uri</code> с публичными ключами. Метаданные кэшируются и периодически обновляются; при встрече незнакомого <code>kid</code> обработчик может перечитать их — так переживается ротация ключей на стороне IdP.</li>
<li>Проверяет подпись ключом с нужным <code>kid</code> и допустимым алгоритмом.</li>
<li>Проверяет <strong>issuer</strong> (<code>iss</code>) — токен выпущен именно нашим IdP и realm’ом.</li>
<li>Проверяет <strong>audience</strong> (<code>aud</code>) — токен выпущен для нашего API, а не для соседнего сервиса. Без этой проверки токен, полученный для любого клиента того же IdP, подойдёт и к вам.</li>
<li>Проверяет <strong>время жизни</strong>: <code>exp</code> и <code>nbf</code> с допуском <code>ClockSkew</code> на расхождение часов. Значение по умолчанию — 5 минут, то есть токен считается живым ещё 5 минут после истечения; для коротких токенов это заметно, и его часто уменьшают.</li>
<li>Строит <code>ClaimsPrincipal</code> и вызывает событие <code>OnTokenValidated</code>.</li>
</ol>
<p><code>MapInboundClaims</code> по умолчанию включён и переименовывает короткие JWT-claims в длинные URI в стиле WS-Federation (<code>sub</code> превращается в <code>ClaimTypes.NameIdentifier</code>). Это постоянный источник путаницы «почему <code>User.FindFirst("sub")</code> возвращает null», поэтому его часто выключают и работают с оригинальными именами. <code>RequireHttpsMetadata</code> по умолчанию требует HTTPS для загрузки метаданных — выключать его можно только локально.</p>
<blockquote><strong>Важно.</strong> Отзыв JWT невозможен без дополнительной инфраструктуры. Стандартный компромисс — короткий access token (минуты) и refresh token, который IdP может отозвать. Для особо чувствительных операций используют token introspection — запрос к IdP о статусе токена.</blockquote>

<h3>OIDC с внешним IdP на примере Keycloak</h3>
<p>Сам API пароли не принимает и токены не выдаёт — это работа <strong>Identity Provider</strong>: Keycloak, Entra ID, Auth0, Duende IdentityServer. Протокол — <strong>OpenID Connect</strong> поверх OAuth 2.0. Типичная схема для SPA: фронтенд — публичный клиент, проходит <strong>authorization code flow с PKCE</strong> (браузер уходит на страницу входа Keycloak, возвращается с одноразовым кодом и обменивает его на токены), а затем отправляет access token в API в заголовке. API — resource server: только валидирует токены. Сервис-к-сервису используют <strong>client credentials</strong>: сервис сам получает токен по своему client id и секрету.</p>
<p>Особенности Keycloak, о которые спотыкаются:</p>
<ul>
<li><strong>Issuer</strong> — это URL realm’а, <code>https://host/realms/{realm}</code>, и он должен <strong>буквально совпадать</strong> с тем, что API ожидает. Если браузер получает токен по публичному адресу, а API в Docker-сети обращается к Keycloak по внутреннему имени, <code>iss</code> в токене и ожидаемый issuer разойдутся — валидация упадёт. Лечится единым именем хоста для обеих сторон или явным <code>ValidIssuer</code> при загрузке метаданных по внутреннему адресу.</li>
<li><strong>Audience</strong>: по умолчанию в <code>aud</code> access token’а Keycloak кладёт <code>account</code>, а не ваш API. Нужный audience добавляют через audience mapper или client scope, назначенный клиенту фронтенда.</li>
<li><strong>Роли</strong> лежат во вложенном JSON: роли realm’а — в <code>realm_access.roles</code>, роли клиента — в <code>resource_access.{clientId}.roles</code>. Ни <code>[Authorize(Roles = ...)]</code>, ни <code>RequireRole</code> об этом формате не знают — их нужно развернуть в плоские claims (claims transformation, см. ниже) или настроить mapper в Keycloak, кладущий роли в плоский claim.</li>
</ul>
<pre><code>// Если API ходит к Keycloak по внутреннему имени, а токены выпущены на публичное
options.MetadataAddress = "http://keycloak:8080/realms/polestar/.well-known/openid-configuration";
options.RequireHttpsMetadata = false;               // только внутри доверенной сети
options.TokenValidationParameters.ValidIssuer = "https://sso.example.com/realms/polestar";</code></pre>
<p>Для серверных приложений с собственным UI (Razor, BFF) используют <code>AddOpenIdConnect</code> вместе с cookie-схемой: OIDC-обработчик проводит вход через редиректы, а результат сохраняется в зашифрованной cookie. Токены IdP при этом могут храниться на сервере (<code>SaveTokens</code>) и не попадать в браузер.</p>

<h3>Cookies или токены</h3>
<p>Это не противопоставление «старое/новое», а выбор места хранения учётных данных клиента и модели угроз.</p>
<table>
<thead><tr><th></th><th>Cookie (HttpOnly, Secure, SameSite)</th><th>Токен в заголовке</th></tr></thead>
<tbody>
<tr><td>Отправка</td><td>браузер прикладывает автоматически</td><td>клиент добавляет явно</td></tr>
<tr><td>Кража через XSS</td><td>JS не может прочитать HttpOnly-cookie</td><td>токен в памяти или localStorage доступен вредоносному скрипту</td></tr>
<tr><td>CSRF</td><td>есть риск: нужен SameSite и/или antiforgery</td><td>нет: чужой сайт не может добавить заголовок</td></tr>
<tr><td>Клиенты</td><td>браузер, один домен или BFF</td><td>мобильные, сервисы, SPA, разные домены</td></tr>
<tr><td>Отзыв</td><td>сессия на сервере — можно убить</td><td>JWT живёт до <code>exp</code></td></tr>
</tbody>
</table>
<p>Для браузерных SPA всё популярнее паттерн <strong>BFF (Backend for Frontend)</strong>: SPA общается только со своим бэкендом через HttpOnly-cookie, а бэкенд держит OIDC-токены у себя и проксирует запросы к API, прикладывая access token. Токены не попадают в браузер вовсе, XSS не может их украсть. Цена — дополнительный компонент и необходимость защиты от CSRF.</p>
<p>Если SPA хранит токены сам, лучше держать их в памяти, а не в localStorage, делать access token коротким, а refresh token — с ротацией. Для мобильных приложений и межсервисного взаимодействия bearer-токены — естественный выбор.</p>

<h3>Политики, требования и обработчики</h3>
<p>Простейшая авторизация — атрибуты: <code>[Authorize]</code> (нужен любой аутентифицированный пользователь), <code>[Authorize(Roles = "admin")]</code>, <code>[AllowAnonymous]</code>. Для всего, что сложнее, используются <strong>политики</strong>: именованные наборы требований.</p>
<pre><code>builder.Services.AddAuthorizationBuilder()
    .AddPolicy("orders.write", policy =&gt; policy
        .RequireAuthenticatedUser()
        .RequireClaim("scope", "orders.write"))
    .AddPolicy("adult", policy =&gt; policy.AddRequirements(new MinimumAgeRequirement(18)))
    // Безопасность по умолчанию: эндпоинты без атрибутов авторизации тоже требуют входа
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

app.MapPost("/v1/orders", CreateOrder).RequireAuthorization("orders.write");</code></pre>
<p><strong>DefaultPolicy</strong> применяется к <code>[Authorize]</code> без указания политики. <strong>FallbackPolicy</strong> — к эндпоинтам, у которых нет никаких метаданных авторизации; задав её, вы получаете «закрыто по умолчанию»: новый эндпоинт, где забыли атрибут, не окажется публичным. Открытые эндпоинты тогда помечают <code>[AllowAnonymous]</code> явно.</p>
<p>Политика состоит из <strong>требований</strong> (<code>IAuthorizationRequirement</code> — просто класс с данными) и <strong>обработчиков</strong>, которые их проверяют:</p>
<pre><code>public sealed record PermissionRequirement(string Permission) : IAuthorizationRequirement;

public sealed class PermissionHandler(IPermissionStore store) : AuthorizationHandler&lt;PermissionRequirement&gt;
{
    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        var userId = context.User.FindFirst("sub")?.Value;
        if (userId is not null &amp;&amp; await store.HasAsync(userId, requirement.Permission))
            context.Succeed(requirement);
        // не вызываем Fail: другой обработчик того же требования может его удовлетворить
    }
}

builder.Services.AddScoped&lt;IAuthorizationHandler, PermissionHandler&gt;();</code></pre>
<p>Правила вычисления: политика успешна, если <strong>все</strong> её требования удовлетворены. Требование удовлетворено, если хотя бы один обработчик вызвал <code>Succeed</code> и ни один не вызвал <code>Fail</code>. Поэтому <code>Fail</code> — это «жёсткое вето», а обычный «не подходит» — просто ничего не делать. Обработчики резолвятся из DI, могут быть scoped и ходить в базу или кэш.</p>
<p>Когда политик много и они параметризованы («Permission:ManageOrders», «Permission:ViewPrices»), регистрировать каждую вручную неудобно. Решения — свой <code>IAuthorizationPolicyProvider</code>, строящий политику по имени на лету, или, с .NET 8, атрибут, реализующий <code>IAuthorizationRequirementData</code>, который сам отдаёт требования для эндпоинта.</p>

<h3>Resource-based authorization</h3>
<p>Атрибут на эндпоинте не знает, к какому ресурсу идёт обращение: «редактировать заказ может его автор или менеджер его компании» нельзя проверить до загрузки заказа. Для этого авторизацию вызывают <strong>императивно</strong>, внутри обработчика, через <code>IAuthorizationService</code>, передавая сам ресурс:</p>
<pre><code>public sealed class SameTenantHandler : AuthorizationHandler&lt;OperationRequirement, Order&gt;
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context, OperationRequirement requirement, Order order)
    {
        var tenant = context.User.FindFirst("tenant_id")?.Value;
        if (tenant == order.TenantId.ToString() &amp;&amp;
            (requirement.Name == "Read" || context.User.HasClaim("permission", "orders.manage")))
        {
            context.Succeed(requirement);
        }
        return Task.CompletedTask;
    }
}

// в эндпоинте
var order = await db.Orders.FindAsync([id], ct);
if (order is null) return TypedResults.NotFound();

var result = await authorization.AuthorizeAsync(User, order, new OperationRequirement("Update"));
if (!result.Succeeded) return TypedResults.Forbid();</code></pre>
<p>Выбор между 403 и 404 — осознанный: если само существование ресурса — секрет (заказ другой компании), отвечают <strong>404</strong>, чтобы не давать подбирать идентификаторы. Если пользователь ресурс видит, но не может менять, — 403.</p>
<p>Resource-based авторизация не заменяет фильтрацию на уровне данных: список заказов должен <strong>запрашиваться</strong> уже отфильтрованным по tenant’у (global query filter в EF Core, row-level security в PostgreSQL), а не загружаться целиком и проверяться по одному.</p>

<h3>Claims transformation</h3>
<p>Токен IdP редко содержит claims ровно в той форме, которая удобна приложению: роли Keycloak вложены в JSON, права зависят от компании, часть данных лежит в вашей базе. <code>IClaimsTransformation</code> позволяет дополнить пользователя после аутентификации:</p>
<pre><code>public sealed class KeycloakRolesTransformation : IClaimsTransformation
{
    public Task&lt;ClaimsPrincipal&gt; TransformAsync(ClaimsPrincipal principal)
    {
        if (principal.Identity is not ClaimsIdentity { IsAuthenticated: true } identity
            || principal.HasClaim(c =&gt; c.Type == "role"))         // уже трансформировали
            return Task.FromResult(principal);

        var realmAccess = identity.FindFirst("realm_access")?.Value;
        if (realmAccess is null) return Task.FromResult(principal);

        using var json = JsonDocument.Parse(realmAccess);
        if (json.RootElement.TryGetProperty("roles", out var roles))
        {
            // roleType обязателен: у new ClaimsIdentity() RoleClaimType = ClaimTypes.Role, и IsInRole не увидит "role"
            var extra = new ClaimsIdentity(authenticationType: null, nameType: null, roleType: "role");
            foreach (var role in roles.EnumerateArray())
                extra.AddClaim(new Claim("role", role.GetString()!));
            principal.AddIdentity(extra);
        }
        return Task.FromResult(principal);
    }
}

builder.Services.AddTransient&lt;IClaimsTransformation, KeycloakRolesTransformation&gt;();</code></pre>
<p>Подводные камни: трансформация вызывается при <strong>каждом</strong> вызове <code>AuthenticateAsync</code>, и в рамках одного запроса это может случиться несколько раз — поэтому она должна быть <strong>идемпотентной</strong> (не добавлять одинаковые claims повторно) и дешёвой. Если ей нужна база, результаты кэшируют. Альтернатива для JWT — событие <code>OnTokenValidated</code>, которое срабатывает один раз при валидации токена. Помните, что <code>RoleClaimType</code> той identity, в которую добавлены claims, должен совпадать с их типом, иначе <code>IsInRole</code> их не увидит: <code>IsInRole</code> проверяет каждую identity по её собственному <code>RoleClaimType</code>, а <code>RoleClaimType</code> из параметров валидации JWT касается только identity из токена.</p>

<h3>Multi-tenancy</h3>
<p>В SaaS один и тот же пользователь может работать в нескольких компаниях, и права у него в каждой свои. Отсюда несколько решений, которые нужно уметь обосновать:</p>
<ul>
<li><strong>Откуда берётся tenant.</strong> Варианты: claim в токене, заголовок (<code>x-organization-uuid</code>), поддомен, сегмент пути. Claim надёжен, но требует отдельного токена на компанию или повторного входа при переключении. Заголовок удобен для переключения, но <strong>ему нельзя верить на слово</strong>: на каждый запрос нужно проверить, что пользователь в этом tenant’е состоит.</li>
<li><strong>Где лежат права.</strong> Класть права всех компаний в токен — токен раздувается и устаревает до истечения; роли realm’а попадают в токен «для всех компаний сразу». Часто права хранят отдельно и вычисляют на запрос по паре «пользователь + tenant», с кэшем и сбросом при изменении.</li>
<li><strong>Изоляция данных.</strong> Tenant из запроса передаётся в scoped-контекст, оттуда — в <code>DbContext</code> (global query filter) и/или в сессию PostgreSQL для row-level security. Тогда забытый <code>Where</code> не приведёт к утечке.</li>
<li><strong>Ответ на чужой tenant</strong> — 404, а не 403, чтобы не подтверждать существование чужих данных.</li>
<li><strong>Фоновые задачи</strong> не имеют запроса и пользователя: tenant нужно явно передавать в сообщение или задачу и устанавливать контекст в каждом scope воркера.</li>
</ul>
<pre><code>public sealed class OrganizationFilter(IMembershipService membership, ITenantContext tenant) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext ctx, ActionExecutionDelegate next)
    {
        var header = ctx.HttpContext.Request.Headers["x-organization-uuid"].ToString();
        var userId = ctx.HttpContext.User.FindFirst("sub")?.Value;
        if (!Guid.TryParse(header, out var orgId) || userId is null
            || !await membership.IsMemberAsync(userId, orgId))
        {
            ctx.Result = new NotFoundResult();
            return;
        }
        tenant.Set(orgId);      // дальше его читают DbContext и обработчики
        await next();
    }
}</code></pre>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Что проверяет JWT bearer middleware при каждом запросе?»</summary>
<p>Он берёт токен из заголовка <code>Authorization</code>, по <code>Authority</code> загружает и кэширует discovery-документ и JWKS с публичными ключами, затем проверяет подпись ключом с нужным <code>kid</code>, издателя <code>iss</code>, аудиторию <code>aud</code> и время жизни <code>exp</code>/<code>nbf</code> с допуском <code>ClockSkew</code>, который по умолчанию 5 минут. Если всё сходится, строит <code>ClaimsPrincipal</code> и вызывает <code>OnTokenValidated</code>. В IdP на каждый запрос он не ходит, поэтому выданный токен нельзя отозвать — отсюда короткие access token’ы и refresh token’ы. Проверка audience критична: без неё к API подойдёт токен, выпущенный тем же IdP для любого другого клиента. И я обычно выключаю <code>MapInboundClaims</code>, чтобы <code>sub</code> оставался <code>sub</code>.</p>
</details>
<details><summary>«Чем аутентификация отличается от авторизации и почему невалидный токен иногда не даёт 401?»</summary>
<p>Аутентификация строит пользователя из запроса, авторизация решает, что ему можно. <code>UseAuthentication</code> при неудаче не отклоняет запрос — пользователь просто становится анонимным. Отклоняет авторизация: если эндпоинт требует аутентифицированного пользователя, вызывается Challenge, и bearer-схема отвечает 401; если пользователь есть, но прав нет, — Forbid и 403. Поэтому на эндпоинте с <code>[AllowAnonymous]</code> или без требований авторизации невалидный токен ошибки не вызовет. Чтобы не было случайно открытых эндпоинтов, я задаю FallbackPolicy с <code>RequireAuthenticatedUser</code>.</p>
</details>
<details><summary>«Как подключить Keycloak к ASP.NET Core API? Какие были проблемы?»</summary>
<p><code>AddJwtBearer</code> с <code>Authority</code> на URL realm’а и <code>Audience</code> своего API. Первая проблема — audience: по умолчанию Keycloak кладёт в токен <code>account</code>, поэтому в Keycloak добавляется audience mapper или client scope с нужной аудиторией. Вторая — роли во вложенном <code>realm_access.roles</code>, которые стандартная проверка ролей не понимает: их разворачивают claims transformation’ом или mapper’ом в плоский claim. Третья — issuer: он должен буквально совпадать, а в Docker браузер и API часто видят Keycloak по разным адресам, тогда <code>iss</code> не совпадает. Решается единым именем хоста или явным <code>ValidIssuer</code> при загрузке метаданных по внутреннему адресу. Фронтенд — публичный клиент с authorization code flow и PKCE.</p>
</details>
<details><summary>«Как устроены политики авторизации и что такое requirement и handler?»</summary>
<p>Политика — именованный набор требований; требование — класс-маркер с данными, реализующий <code>IAuthorizationRequirement</code>; обработчик — <code>AuthorizationHandler&lt;TRequirement&gt;</code>, который проверяет требование и вызывает <code>context.Succeed</code>. Политика успешна, если удовлетворены все требования; требование удовлетворено, если хоть один обработчик вызвал <code>Succeed</code> и ни один не вызвал <code>Fail</code>. Обработчики — обычные сервисы из DI, могут ходить в базу и кэш. Для множества параметризованных политик вроде «Permission:X» пишу свой <code>IAuthorizationPolicyProvider</code> или атрибут с <code>IAuthorizationRequirementData</code> из .NET 8. FallbackPolicy закрывает всё, что не размечено.</p>
</details>
<details><summary>«Что такое resource-based authorization и когда она нужна?»</summary>
<p>Когда решение зависит от конкретного ресурса — автор заказа, компания, которой принадлежит документ, — атрибут на эндпоинте его не знает. Тогда ресурс загружают и вызывают <code>IAuthorizationService.AuthorizeAsync(User, resource, requirement)</code>, а обработчик наследует <code>AuthorizationHandler&lt;TRequirement, TResource&gt;</code>. По результату возвращают 403 или 404 — второе, если существование ресурса само по себе секрет. Но это не замена фильтрации данных: списки должны запрашиваться уже отфильтрованными по tenant’у через query filter или RLS, а не проверяться поштучно после загрузки.</p>
</details>
<details><summary>«Где хранить токены в SPA: cookie или localStorage?»</summary>
<p>localStorage уязвим к XSS: любой внедрённый скрипт прочитает токен. HttpOnly-cookie скрипт прочитать не может, но cookie отправляется автоматически, поэтому появляется CSRF, и нужны SameSite и antiforgery. Лучший вариант для браузера — BFF: SPA общается со своим бэкендом по HttpOnly-cookie, а OIDC-токены живут на сервере и в браузер не попадают. Если SPA работает с токенами сам — authorization code с PKCE, токены в памяти, короткий access token и refresh token с ротацией. Для мобильных и межсервисных клиентов bearer-токены естественны, межсервисно — client credentials.</p>
</details>
<details><summary>«Какие подводные камни у IClaimsTransformation?»</summary>
<p>Она вызывается на каждый вызов <code>AuthenticateAsync</code>, а их в одном запросе может быть несколько, поэтому должна быть идемпотентной — не добавлять те же claims второй раз — и дешёвой. Если нужны данные из базы, их кэшируют, иначе каждый запрос получит лишние обращения. Тип добавляемых ролей должен совпадать с <code>RoleClaimType</code>, иначе <code>IsInRole</code> и <code>[Authorize(Roles)]</code> их не увидят. Лучше не мутировать исходную identity, а добавить новую. Для JWT альтернатива — событие <code>OnTokenValidated</code>, оно срабатывает один раз на валидацию токена.</p>
</details>
<details><summary>«Как бы ты сделал авторизацию в multi-tenant SaaS, где один пользователь работает в нескольких компаниях?»</summary>
<p>Tenant приходит в запросе — заголовком или сегментом пути — и на каждом запросе проверяется членство пользователя в нём; чужой или несуществующий tenant — 404. Права я бы не клал в токен: для нескольких компаний токен раздувается, а роли realm’а действуют сразу во всех компаниях. Права вычисляются по паре «пользователь + tenant» из хранилища ролей с кэшем и сбросом при изменении, и проверяются политиками с требованиями вида «Permission:X». Tenant кладётся в scoped-контекст, откуда его берут <code>DbContext</code> и row-level security в PostgreSQL — так забытый фильтр не приводит к утечке. В фоновых задачах tenant передаётся явно в сообщении, и контекст устанавливается в каждом scope воркера.</p>
</details>`},

    { id: 'background', title: 'Фоновая работа', html: `<h3>IHostedService и BackgroundService</h3>
<p>Всё, что должно работать в процессе независимо от HTTP-запросов, — consumer Kafka, публикация outbox, периодическая очистка, рассылка push-уведомлений — оформляется как <strong>hosted service</strong>. Интерфейс минимален:</p>
<pre><code>public interface IHostedService
{
    Task StartAsync(CancellationToken cancellationToken);  // хост ждёт завершения при старте
    Task StopAsync(CancellationToken cancellationToken);   // хост ждёт завершения при остановке
}

builder.Services.AddHostedService&lt;OutboxPublisher&gt;();      // регистрируется как singleton</code></pre>
<p>Хост вызывает <code>StartAsync</code> у всех зарегистрированных сервисов при запуске (по умолчанию последовательно, в порядке регистрации) и <code>StopAsync</code> — при остановке, в обратном порядке. Важно, что <code>StartAsync</code> хост <strong>ожидает</strong>: пока он не завершился, запуск не продолжается.</p>
<p>Для типичного случая «бесконечный цикл до остановки» есть абстрактный класс <strong><code>BackgroundService</code></strong>. Он реализует <code>IHostedService</code> и требует один метод — <code>ExecuteAsync(CancellationToken stoppingToken)</code>:</p>
<ul>
<li><code>StartAsync</code> вызывает <code>ExecuteAsync</code>, запоминает возвращённую задачу и возвращает управление хосту, не дожидаясь её окончания;</li>
<li><code>StopAsync</code> отменяет <code>stoppingToken</code> и ждёт завершения задачи <code>ExecuteAsync</code> — но не дольше, чем позволяет токен, переданный в <code>StopAsync</code> (он срабатывает по истечении shutdown timeout).</li>
</ul>
<pre><code>public sealed class OrderEventsConsumer(IConsumer&lt;string, string&gt; consumer, IServiceScopeFactory scopes,
    ILogger&lt;OrderEventsConsumer&gt; logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();                         // см. следующий раздел
        consumer.Subscribe("orders");
        while (!stoppingToken.IsCancellationRequested)
        {
            var result = consumer.Consume(stoppingToken);   // блокирующий вызов, принимает токен
            await using var scope = scopes.CreateAsyncScope();
            var handler = scope.ServiceProvider.GetRequiredService&lt;IOrderEventHandler&gt;();
            await handler.HandleAsync(result.Message, stoppingToken);
            consumer.Commit(result);
        }
    }

    public override void Dispose()
    {
        consumer.Close();   // корректно покинуть consumer group
        base.Dispose();
    }
}</code></pre>
<p>Hosted service — singleton, поэтому всё, что нужно на каждую операцию, создаётся через <code>IServiceScopeFactory</code> (подробно — в главе про DI). Если нужен контроль над этапами запуска (например, «прогреть кэш строго до старта остальных»), с .NET 8 есть <code>IHostedLifecycleService</code> с методами <code>StartingAsync</code>, <code>StartedAsync</code>, <code>StoppingAsync</code>, <code>StoppedAsync</code>.</p>

<h3>Ловушка блокирующего StartAsync</h3>
<p>Самая известная проблема фоновых сервисов: <code>BackgroundService.StartAsync</code> вызывает <code>ExecuteAsync</code> <strong>синхронно</strong> — до первого настоящего <code>await</code>, который реально уступает поток. Всё, что выполняется до этого момента, выполняется в потоке запуска хоста. Если в начале <code>ExecuteAsync</code> стоит синхронный цикл или блокирующий вызов, хост не продолжит запуск: остальные hosted services не стартуют, и веб-сервер может так и не начать принимать запросы.</p>
<pre><code>protected override async Task ExecuteAsync(CancellationToken ct)
{
    // Плохо: Consume блокирует поток, а до первого await мы на потоке запуска хоста.
    // Приложение «висит» на старте, health check не отвечает.
    while (!ct.IsCancellationRequested)
    {
        var msg = consumer.Consume(ct);
        await HandleAsync(msg, ct);   // await есть, но до него выполнение не дойдёт, пока нет сообщений
    }
}</code></pre>
<p>Та же ловушка с прямой реализацией <code>IHostedService</code>: если в <code>StartAsync</code> написать бесконечный цикл или долгий <code>await</code> (например, ожидание всех партиций), запуск приложения будет ждать его. <code>StartAsync</code> должен только <strong>запустить</strong> работу и быстро вернуть управление.</p>
<p>Исправления:</p>
<ul>
<li>в начале <code>ExecuteAsync</code> вызвать <code>await Task.Yield()</code> — остаток метода продолжится уже не в потоке запуска;</li>
<li>явно вынести тяжёлую работу: <code>return Task.Run(() =&gt; LoopAsync(ct), ct)</code> — особенно для по-настоящему блокирующих API вроде <code>Consume</code> клиента Kafka, которому нужен отдельный поток, чтобы не занимать поток пула надолго (с <code>TaskCreationOptions.LongRunning</code> при использовании <code>Task.Factory.StartNew</code>);</li>
<li>в <code>IHostedService.StartAsync</code> запускать задачу и сохранять её в поле, а не ждать её.</li>
</ul>
<p>Начиная с .NET 10 базовый <code>BackgroundService</code> запускает <code>ExecuteAsync</code> в фоне целиком, и этот нюанс сглажен. Но на .NET 8–9 ловушка в силе, а для собственных реализаций <code>IHostedService</code> — всегда, так что код лучше писать так, чтобы от этого не зависеть.</p>
<blockquote><strong>Важно.</strong> Блокирующий вызов в фоновом цикле, даже после <code>Task.Yield</code>, занимает поток пула на всё время работы. Один такой сервис — не проблема, десяток консьюмеров с синхронным <code>Consume</code> на потоках пула могут заметно ухудшить отзывчивость веб-части. Для долгоживущих блокирующих циклов используют выделенный поток.</blockquote>

<h3>Graceful shutdown и отмена</h3>
<p>При SIGTERM хост начинает остановку: срабатывает <code>IHostApplicationLifetime.ApplicationStopping</code>, затем вызывается <code>StopAsync</code> hosted services в обратном порядке регистрации. У <code>BackgroundService</code> это означает отмену <code>stoppingToken</code>. Дальше всё зависит от того, уважает ли ваш код этот токен.</p>
<p>Правила корректной остановки:</p>
<ul>
<li><strong>передавайте <code>stoppingToken</code> во все асинхронные вызовы</strong>: <code>Task.Delay</code>, запросы к базе, HTTP, <code>Consume</code>. Иначе сервис «не слышит» остановку и висит до таймаута;</li>
<li>решите, что делать с <strong>текущей единицей работы</strong>. Иногда правильно дать ей завершиться (дописать в базу, закоммитить офсет), а не обрывать посередине — тогда для неё используют отдельный токен или <code>CancellationToken.None</code> с собственным ограничением по времени;</li>
<li><code>OperationCanceledException</code> при остановке — нормальное поведение, а не ошибка; не логируйте её как Error;</li>
<li>уложитесь в <code>HostOptions.ShutdownTimeout</code> (по умолчанию 30 секунд), а его — в <code>terminationGracePeriodSeconds</code> Kubernetes, иначе процесс убьют SIGKILL’ом.</li>
</ul>
<pre><code>protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    try
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var batch = await queue.TakeBatchAsync(100, stoppingToken);
            // Батч, который уже взяли, доделываем, даже если пришла остановка, но не дольше 10 секунд
            using var finish = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await ProcessAsync(batch, finish.Token);
        }
    }
    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
    {
        // штатная остановка
    }
}

builder.Services.Configure&lt;HostOptions&gt;(o =&gt; o.ShutdownTimeout = TimeSpan.FromSeconds(25));</code></pre>
<p>Для consumer’а Kafka graceful shutdown особенно важен: нужно закоммитить офсеты обработанного и вызвать <code>Close()</code>, чтобы consumer покинул группу явно. Иначе брокер ждёт session timeout, прежде чем отдать партиции другим экземплярам, и сообщения обрабатываются с задержкой, а некоммиченные — повторно.</p>

<h3>Исключения в фоновом сервисе</h3>
<p>Что будет, если <code>ExecuteAsync</code> выбросит исключение? Начиная с .NET 6 поведение по умолчанию — <code>BackgroundServiceExceptionBehavior.StopHost</code>: исключение логируется, и <strong>весь хост останавливается</strong>. До .NET 6 исключение молча «съедалось»: сервис переставал работать, а приложение продолжало отвечать на health checks, как будто всё в порядке. Новое поведение честнее — оркестратор перезапустит упавший под.</p>
<pre><code>builder.Services.Configure&lt;HostOptions&gt;(o =&gt;
    o.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.Ignore); // вернуть старое — редко правильно</code></pre>
<p>Но падение всего процесса из-за одного плохого сообщения — тоже плохо. Поэтому внутри цикла ошибки обработки <strong>одной единицы работы</strong> ловят и обрабатывают: логируют, отправляют сообщение в DLQ (dead letter topic) или откладывают на повтор, применяют паузу (backoff), чтобы не крутиться в горячем цикле. До хоста должны долетать только фатальные ошибки, после которых продолжать нельзя.</p>
<pre><code>while (!stoppingToken.IsCancellationRequested)
{
    try
    {
        await ProcessNextAsync(stoppingToken);
    }
    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
    {
        break;
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Outbox iteration failed");
        await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);   // не долбить базу в цикле
    }
}</code></pre>

<h3>Периодические задачи</h3>
<p>Для «делать раз в N секунд» в .NET 6 появился <code>PeriodicTimer</code> — асинхронный таймер, который не создаёт перекрывающихся тиков: следующий тик ждётся только после того, как вы закончили обработку предыдущего.</p>
<pre><code>protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
    do
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService&lt;IReminderSweep&gt;().RunAsync(stoppingToken);
    }
    while (await timer.WaitForNextTickAsync(stoppingToken));
}</code></pre>
<p>Чем он лучше <code>System.Threading.Timer</code> с колбэком: колбэк таймера — синхронный, вызывается на пуле, и если обработка длиннее интервала, вызовы перекрываются; <code>async void</code> внутри колбэка теряет исключения. <code>PeriodicTimer</code> встраивается в обычный <code>async</code>-цикл с отменой.</p>
<p>Важный вопрос при нескольких репликах: задача выполнится в <strong>каждом</strong> экземпляре. Если это недопустимо (отправить напоминание один раз), нужна координация: блокировка в базе (<code>pg_try_advisory_xact_lock</code>), <code>SELECT ... FOR UPDATE SKIP LOCKED</code> для разбора очереди строк, уникальный ключ идемпотентности — или внешний планировщик.</p>

<h3>Channels как in-process очередь</h3>
<p><code>System.Threading.Channels</code> — высокопроизводительная асинхронная очередь producer/consumer внутри процесса. Типичный сценарий: HTTP-запрос быстро кладёт работу в канал и отвечает 202, а фоновый сервис разбирает канал.</p>
<pre><code>public sealed class ThumbnailQueue
{
    private readonly Channel&lt;Guid&gt; _channel = Channel.CreateBounded&lt;Guid&gt;(new BoundedChannelOptions(1000)
    {
        FullMode = BoundedChannelFullMode.Wait,   // при переполнении писатель ждёт — backpressure
        SingleReader = true,
    });

    public ValueTask EnqueueAsync(Guid mediaId, CancellationToken ct) =&gt; _channel.Writer.WriteAsync(mediaId, ct);
    public IAsyncEnumerable&lt;Guid&gt; ReadAllAsync(CancellationToken ct) =&gt; _channel.Reader.ReadAllAsync(ct);
}

public sealed class ThumbnailWorker(ThumbnailQueue queue, IServiceScopeFactory scopes) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var mediaId in queue.ReadAllAsync(stoppingToken))
        {
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService&lt;IThumbnailer&gt;().MakeAsync(mediaId, stoppingToken);
        }
    }
}

builder.Services.AddSingleton&lt;ThumbnailQueue&gt;();
builder.Services.AddHostedService&lt;ThumbnailWorker&gt;();</code></pre>
<p>Почему channel, а не <code>ConcurrentQueue</code> с опросом или <code>BlockingCollection</code>: читатель асинхронно ждёт данных, не занимая поток и не опрашивая в цикле; bounded-канал даёт <strong>backpressure</strong> — при переполнении писатель ждёт (или элементы отбрасываются, в зависимости от <code>FullMode</code>), и память не растёт бесконечно. Unbounded-канал проще, но под нагрузкой может съесть всю память.</p>
<blockquote><strong>Важно.</strong> Channel живёт в памяти процесса. Рестарт, деплой или падение — и всё, что лежало в канале, потеряно. Для работы, которую нельзя потерять, нужна durable-очередь: Kafka, RabbitMQ, таблица в базе (outbox), Hangfire. Channel хорош для того, что можно восстановить или потерять без последствий: превью, метрики, кэш-прогрев, батчинг записи.</blockquote>

<h3>Когда брать Quartz или Hangfire</h3>
<p><code>BackgroundService</code> плюс база данных покрывают много: периодические зачистки, outbox, разбор очереди строк. Но есть задачи, где своё решение превращается в самописный планировщик со всеми его проблемами. Тогда берут готовое:</p>
<ul>
<li><strong>Quartz.NET</strong> — планировщик: cron-выражения, календари (исключить праздники), misfire handling (что делать с пропущенным запуском), persistent job store в базе и кластеризация, чтобы задача выполнилась ровно на одном узле. Хорош, когда расписания — <strong>данные</strong>, которые пользователи настраивают сами.</li>
<li><strong>Hangfire</strong> — постоянные фоновые задачи: fire-and-forget, отложенные, повторяющиеся, продолжения, с хранением в SQL Server, PostgreSQL или Redis, автоматическими повторами при ошибках и дашбордом. Хорош, когда нужно «выполнить это обязательно, даже если процесс упадёт, и показать, что упало».</li>
</ul>
<p>Цена обеих — собственные таблицы и схема в базе, миграции, отдельная история резервного копирования, и (для Hangfire) сериализация вызова метода с аргументами, из-за чего рефакторинг сигнатур ломает задачи в очереди. Если в системе уже есть Kafka, многие «фоновые задачи» лучше выражаются событиями и консьюмерами. Хороший ответ на собеседовании — не «всегда Hangfire», а критерии: нужна ли durability, нужно ли расписание как данные, сколько реплик, нужно ли ровно-однажды выполнение, есть ли уже брокер.</p>

<h3>Health checks</h3>
<p>Health checks — эндпоинты, по которым оркестратор и балансировщик понимают, жив ли сервис и можно ли слать ему трафик.</p>
<pre><code>builder.Services.AddHealthChecks()
    .AddCheck("self", () =&gt; HealthCheckResult.Healthy(), tags: ["live"])
    .AddNpgSql(connectionString, name: "postgres", tags: ["ready"])   // пакет AspNetCore.HealthChecks.NpgSql
    .AddCheck&lt;KafkaHealthCheck&gt;("kafka", tags: ["ready"]);

app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = c =&gt; c.Tags.Contains("live") });
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = c =&gt; c.Tags.Contains("ready") });

public sealed class KafkaHealthCheck(IKafkaConnectivity kafka) : IHealthCheck
{
    public async Task&lt;HealthCheckResult&gt; CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
        =&gt; await kafka.CanReachBrokerAsync(ct)
            ? HealthCheckResult.Healthy()
            : HealthCheckResult.Unhealthy("Kafka broker unreachable");
}</code></pre>
<p>Ключевое различие в Kubernetes:</p>
<ul>
<li><strong>Liveness</strong> — «процесс жив и не завис». При провале под <strong>перезапускается</strong>. Поэтому liveness <strong>не должен</strong> проверять внешние зависимости: если упала база, перезапуск всех подов её не починит, зато вызовет каскад рестартов и холодных стартов.</li>
<li><strong>Readiness</strong> — «готов принимать трафик». При провале под выводится из балансировки, но не перезапускается. Здесь уместны проверки базы, брокера, прогретого кэша.</li>
<li><strong>Startup probe</strong> — для медленного старта: пока он не прошёл, liveness не проверяется.</li>
</ul>
<p>По умолчанию <code>Healthy</code> и <code>Degraded</code> отвечают 200, <code>Unhealthy</code> — 503. Health-эндпоинты обычно не требуют авторизации, но не должны отдавать наружу подробности (строки подключения, версии) — детальный ответ публикуют только на внутреннем порту или отдельном пути. Проверки выполняются на каждый запрос пробы, поэтому дорогие проверки кэшируют или вычисляют фоном (<code>IHealthCheckPublisher</code>).</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Чем BackgroundService отличается от IHostedService?»</summary>
<p><code>IHostedService</code> — базовый интерфейс с <code>StartAsync</code> и <code>StopAsync</code>, которые хост ожидает при запуске и остановке. <code>BackgroundService</code> — абстрактный класс поверх него для долгоживущей работы: вы реализуете <code>ExecuteAsync</code>, а базовый класс запускает его, не дожидаясь окончания, и при остановке отменяет <code>stoppingToken</code> и ждёт завершения задачи в пределах shutdown timeout. Прямую реализацию <code>IHostedService</code> беру, когда нужно что-то сделать один раз при старте или остановке — например, прогреть кэш до начала приёма трафика. Оба регистрируются через <code>AddHostedService</code> и являются singleton’ами, поэтому scoped-сервисы — только через <code>IServiceScopeFactory</code>.</p>
</details>
<details><summary>«Почему приложение может зависнуть на старте из-за фонового сервиса?»</summary>
<p>Хост ожидает <code>StartAsync</code> каждого hosted service. <code>BackgroundService.StartAsync</code> вызывает <code>ExecuteAsync</code> синхронно до первого реального <code>await</code>, поэтому синхронный цикл или блокирующий вызов в начале — например, <code>Consume</code> клиента Kafka — выполняется в потоке запуска, и остальные сервисы, а с ними и веб-сервер, не стартуют. В собственной реализации <code>IHostedService</code> то же самое, если ждать работу внутри <code>StartAsync</code>. Лечится <code>await Task.Yield()</code> в начале или выносом цикла в отдельную задачу, для долгих блокирующих циклов — в выделенный поток. В .NET 10 базовый класс это сгладил, но я пишу так, чтобы от версии не зависеть.</p>
</details>
<details><summary>«Что происходит с фоновым сервисом при остановке приложения и как сделать её корректной?»</summary>
<p>Хост вызывает <code>StopAsync</code> в обратном порядке регистрации; у <code>BackgroundService</code> отменяется <code>stoppingToken</code>, и хост ждёт завершения <code>ExecuteAsync</code>, но не дольше <code>ShutdownTimeout</code>, по умолчанию 30 секунд. Чтобы остановка была корректной, токен прокидывается во все асинхронные вызовы, а <code>OperationCanceledException</code> при остановке считается штатной. Начатую единицу работы иногда правильно доделать с собственным коротким таймаутом, чем оборвать. Для Kafka — закоммитить офсеты и вызвать <code>Close</code>, чтобы быстро пройти ребалансировку. И таймаут хоста должен укладываться в grace period пода.</p>
</details>
<details><summary>«Что будет, если в ExecuteAsync вылетит исключение?»</summary>
<p>С .NET 6 по умолчанию <code>BackgroundServiceExceptionBehavior.StopHost</code>: исключение логируется, и весь хост останавливается — оркестратор перезапустит под. До .NET 6 оно проглатывалось: сервис молча умирал, а приложение выглядело здоровым. Можно вернуть <code>Ignore</code>, но это почти всегда хуже. Правильная практика — ловить ошибки обработки одной единицы работы внутри цикла: логировать, отправлять в DLQ или откладывать, делать паузу перед следующей попыткой. До хоста должны долетать только фатальные ошибки. Стоит также следить, чтобы liveness не показывал «жив», когда воркер мёртв, — например, через heartbeat фонового цикла.</p>
</details>
<details><summary>«Когда Channel, когда Kafka, когда Hangfire?»</summary>
<p>Channel — in-memory очередь внутри процесса: асинхронное ожидание без опроса, backpressure у bounded-варианта, очень быстро. Но при рестарте содержимое теряется, поэтому он подходит для того, что можно потерять или восстановить: превью, метрики, батчинг. Kafka — durable журнал между сервисами с масштабированием по партициям, когда событие нужно другим системам или нельзя потерять. Hangfire — durable фоновые задачи внутри своего приложения: повторы, отложенный запуск, дашборд, хранение в базе. Quartz — когда главное расписание: cron, календари, misfire, кластер. Для выбора смотрю на durability, нужен ли планировщик, количество реплик и что уже есть в инфраструктуре.</p>
</details>
<details><summary>«Чем liveness отличается от readiness и что в них проверять?»</summary>
<p>Liveness говорит «процесс жив», и при провале Kubernetes перезапускает под, поэтому в нём не должно быть внешних зависимостей: упавшая база не чинится рестартом всех подов, а каскад рестартов только усугубляет инцидент. Readiness говорит «готов принимать трафик», при провале под выводится из балансировки без перезапуска — здесь проверяю базу, брокер, прогретость. Startup probe защищает медленный старт. В ASP.NET Core это разные <code>MapHealthChecks</code> с фильтром по тегам. Ответы — 200 для Healthy и Degraded, 503 для Unhealthy, подробности наружу не отдаю, дорогие проверки кэширую.</p>
</details>
<details><summary>«Как выполнить периодическую задачу ровно один раз при нескольких репликах?»</summary>
<p>Сам <code>BackgroundService</code> запустится в каждой реплике, так что нужна координация. Варианты: advisory lock в PostgreSQL — одна реплика берёт <code>pg_try_advisory_xact_lock</code>, остальные пропускают тик; разбор таблицы-очереди через <code>FOR UPDATE SKIP LOCKED</code>, когда каждая реплика берёт свои строки; уникальный ключ идемпотентности, чтобы повторная обработка ничего не дублировала. Надёжнее всего комбинация: блокировка экономит работу, а идемпотентность гарантирует корректность, если блокировка подведёт. Если расписания сложные или задаются пользователями, беру Quartz с кластерным job store. Внутри цикла — <code>PeriodicTimer</code>, он не даёт тикам перекрываться.</p>
</details>`},

    { id: 'http', title: 'HTTP-клиенты и устойчивость', html: `<h3>HttpClient: socket exhaustion и DNS</h3>
<p><code>HttpClient</code> выглядит как обычный disposable-объект, и интуитивно хочется писать <code>using var client = new HttpClient()</code> на каждый запрос. Это классическая ошибка с двумя противоположными «решениями», каждое из которых по-своему неверно.</p>
<p><strong>Проблема 1 — socket exhaustion.</strong> За <code>HttpClient</code> стоит handler (<code>SocketsHttpHandler</code>), который держит пул TCP-соединений. Создавая и уничтожая клиент на каждый запрос, вы каждый раз открываете новое соединение и закрываете его. Закрытый сокет на стороне инициатора остаётся в состоянии <code>TIME_WAIT</code> на время порядка минуты-двух, занимая локальный порт. Под нагрузкой порты заканчиваются, и новые запросы падают с <code>SocketException</code>. Плюс каждый запрос платит за TCP- и TLS-рукопожатие.</p>
<pre><code>// Плохо: новое соединение на каждый вызов, порты уходят в TIME_WAIT
public async Task&lt;Rate&gt; GetRateAsync(string currency)
{
    using var client = new HttpClient();
    return (await client.GetFromJsonAsync&lt;Rate&gt;($"https://rates.example.com/{currency}"))!;
}</code></pre>
<p><strong>Проблема 2 — DNS.</strong> Логичный ответ — один статический <code>HttpClient</code> на всё приложение. Соединения переиспользуются, порты не утекают. Но пул соединений живёт вечно, а DNS-запрос делается только при открытии соединения. Если адрес сервиса поменялся (blue-green деплой, переезд балансировщика, failover), приложение продолжит слать запросы на старый IP, пока соединения не порвутся.</p>
<p>Правильные решения:</p>
<ul>
<li>долгоживущий <code>HttpClient</code> с <code>SocketsHttpHandler</code>, у которого задан <code>PooledConnectionLifetime</code> — соединения будут периодически пересоздаваться и заново резолвить DNS;</li>
<li>или <strong><code>IHttpClientFactory</code></strong>, который управляет временем жизни handler’ов за вас и встраивается в DI, логирование и политики устойчивости.</li>
</ul>
<pre><code>// Вариант без DI (например, в библиотеке): один клиент, соединения обновляются раз в 2 минуты
private static readonly HttpClient Client = new(new SocketsHttpHandler
{
    PooledConnectionLifetime = TimeSpan.FromMinutes(2),
});</code></pre>

<h3>IHttpClientFactory</h3>
<p><code>IHttpClientFactory</code> (<code>builder.Services.AddHttpClient(...)</code>) решает обе проблемы: он <strong>пулит handler’ы</strong> и раздаёт дешёвые экземпляры <code>HttpClient</code>, обёрнутые вокруг них. Handler живёт <code>HandlerLifetime</code> (по умолчанию 2 минуты), после чего новые клиенты получают новый handler, а старый освобождается, когда его перестанут использовать. Так соединения переиспользуются, но периодически обновляются вместе с DNS.</p>
<pre><code>builder.Services.AddHttpClient("rates", client =&gt;
{
    client.BaseAddress = new Uri("https://rates.example.com/");
    client.Timeout = TimeSpan.FromSeconds(10);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("warehouse-api/1.0");
});

public sealed class RatesService(IHttpClientFactory factory)
{
    public async Task&lt;Rate?&gt; GetAsync(string currency, CancellationToken ct)
    {
        var client = factory.CreateClient("rates");   // дешёвый объект, dispose не обязателен
        return await client.GetFromJsonAsync&lt;Rate&gt;(currency, ct);
    }
}</code></pre>
<p>Что ещё даёт фабрика: централизованную конфигурацию клиентов по имени; конвейер <strong><code>DelegatingHandler</code></strong>’ов (аналог middleware для исходящих запросов — авторизация, корреляция, логирование); интеграцию с Polly и <code>Microsoft.Extensions.Http.Resilience</code>; встроенное логирование исходящих запросов. Утилизировать <code>HttpClient</code> из фабрики можно и нужно не бояться: dispose клиента не освобождает пулящийся handler.</p>
<blockquote><strong>Важно.</strong> <code>HttpClient.Timeout</code> по умолчанию — 100 секунд. Для межсервисных вызовов это почти всегда слишком много: зависший downstream будет держать потоки и соединения вашего сервиса полторы минуты. Ставьте таймауты осознанно, лучше — через стратегии устойчивости.</blockquote>

<h3>Typed clients</h3>
<p>Самый удобный вариант — <strong>типизированный клиент</strong>: класс, который принимает <code>HttpClient</code> в конструкторе и инкапсулирует работу с конкретным API. Код вызывающей стороны знает про методы <code>GetRateAsync</code>, а не про URL и JSON.</p>
<pre><code>public sealed class PaymentsClient(HttpClient http)
{
    public async Task&lt;PaymentStatus&gt; GetStatusAsync(Guid paymentId, CancellationToken ct)
    {
        using var response = await http.GetAsync($"v1/payments/{paymentId}", ct);
        if (response.StatusCode == HttpStatusCode.NotFound) return PaymentStatus.Unknown;
        response.EnsureSuccessStatusCode();
        var dto = await response.Content.ReadFromJsonAsync&lt;PaymentDto&gt;(ct);
        return dto!.Status;
    }
}

builder.Services.AddHttpClient&lt;PaymentsClient&gt;(client =&gt;
{
    client.BaseAddress = new Uri(builder.Configuration["Payments:BaseUrl"]!);
});</code></pre>
<p>Типизированный клиент регистрируется как <strong>transient</strong>: каждый резолв получает свежий <code>HttpClient</code> с текущим handler’ом из пула. Отсюда ловушка: если внедрить typed client в <strong>singleton</strong> (или в <code>BackgroundService</code>), он будет захвачен навсегда вместе со своим handler’ом. Ротация handler’ов перестаёт работать, и проблема DNS возвращается — это та же captive dependency, только с сетевыми последствиями.</p>
<p>Решения для singleton’ов: внедрять <code>IHttpClientFactory</code> и создавать клиент на операцию; или настроить primary handler с <code>PooledConnectionLifetime</code>, тогда даже захваченный клиент будет обновлять соединения:</p>
<pre><code>builder.Services.AddHttpClient&lt;PaymentsClient&gt;(...)
    .ConfigurePrimaryHttpMessageHandler(() =&gt; new SocketsHttpHandler
    {
        PooledConnectionLifetime = TimeSpan.FromMinutes(2),
    })
    .SetHandlerLifetime(Timeout.InfiniteTimeSpan);   // ротацией теперь управляет SocketsHttpHandler</code></pre>

<h3>DelegatingHandler: middleware для исходящих запросов</h3>
<p><code>DelegatingHandler</code> — звено конвейера исходящего запроса: может изменить запрос, вызвать <code>base.SendAsync</code> (следующее звено) и обработать ответ. Через него делают проброс токена, correlation id, подпись запросов, логирование.</p>
<pre><code>public sealed class CorrelationHandler(IHttpContextAccessor accessor) : DelegatingHandler
{
    protected override Task&lt;HttpResponseMessage&gt; SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var id = accessor.HttpContext?.Request.Headers["X-Correlation-Id"].ToString();
        if (!string.IsNullOrEmpty(id))
            request.Headers.TryAddWithoutValidation("X-Correlation-Id", id);
        return base.SendAsync(request, ct);
    }
}

builder.Services.AddHttpContextAccessor();
builder.Services.AddTransient&lt;CorrelationHandler&gt;();
builder.Services.AddHttpClient&lt;PaymentsClient&gt;(...).AddHttpMessageHandler&lt;CorrelationHandler&gt;();</code></pre>
<p>Неочевидная деталь: handler’ы живут вместе с пулящимся primary handler’ом и создаются фабрикой в <strong>собственном DI-scope</strong>, а не в scope текущего HTTP-запроса. Поэтому scoped-сервис, внедрённый в <code>DelegatingHandler</code>, — это не тот экземпляр, что видит ваш контроллер, и он может пережить запрос. Данные текущего запроса (токен пользователя, заголовки) берут через <code>IHttpContextAccessor</code>, как в примере выше. Для простого проброса заголовков есть готовый middleware <code>Microsoft.AspNetCore.HeaderPropagation</code>. Для W3C trace context ничего писать не нужно: <code>HttpClient</code> сам добавляет <code>traceparent</code> при наличии активного <code>Activity</code>.</p>

<h3>Polly v8 и стратегии устойчивости</h3>
<p>В распределённой системе сбои — норма: таймауты, 503 при деплое соседа, кратковременные сетевые ошибки. <strong>Polly</strong> — библиотека стратегий устойчивости. Версия 8 переписана: вместо «policies» — <strong>resilience pipelines</strong> из strategies, единый асинхронный API без аллокаций на горячем пути, встроенная телеметрия.</p>
<p>Основные стратегии:</p>
<ul>
<li><strong>Retry</strong> — повтор при транзиентных ошибках. Экспоненциальная задержка с <strong>jitter</strong>, чтобы тысячи клиентов не повторяли синхронно;</li>
<li><strong>Timeout</strong> — ограничение времени на попытку или на всю операцию;</li>
<li><strong>Circuit breaker</strong> — если доля ошибок превысила порог, «размыкает цепь»: следующие вызовы сразу падают (<code>BrokenCircuitException</code>), не нагружая лежащий сервис; через паузу пропускает пробный вызов (half-open) и по его результату замыкает или снова размыкает цепь;</li>
<li><strong>Rate limiter</strong> — ограничение исходящей нагрузки;</li>
<li><strong>Hedging</strong> — параллельный запасной запрос, если первый не ответил за порог;</li>
<li><strong>Fallback</strong> — значение по умолчанию при неудаче.</li>
</ul>
<pre><code>builder.Services.AddResiliencePipeline("db-read", pipeline =&gt;
{
    pipeline
        .AddRetry(new RetryStrategyOptions
        {
            ShouldHandle = new PredicateBuilder().Handle&lt;NpgsqlException&gt;(ex =&gt; ex.IsTransient),
            MaxRetryAttempts = 3,
            BackoffType = DelayBackoffType.Exponential,
            UseJitter = true,
            Delay = TimeSpan.FromMilliseconds(200),
        })
        .AddTimeout(TimeSpan.FromSeconds(2));
});

public sealed class ReportReader(ResiliencePipelineProvider&lt;string&gt; pipelines, IReportQueries queries)
{
    private readonly ResiliencePipeline _pipeline = pipelines.GetPipeline("db-read");

    public ValueTask&lt;Report&gt; ReadAsync(Guid id, CancellationToken ct) =&gt;
        _pipeline.ExecuteAsync(async token =&gt; await queries.GetAsync(id, token), ct);
}</code></pre>
<p><strong>Порядок стратегий имеет значение</strong>: первая добавленная — внешняя. Timeout <em>после</em> retry ограничивает каждую попытку; timeout <em>до</em> retry ограничивает всю операцию вместе с повторами. Обычно нужны оба.</p>

<h3>Standard resilience handler</h3>
<p>Для HTTP-клиентов Microsoft выпустила пакет <strong><code>Microsoft.Extensions.Http.Resilience</code></strong> поверх Polly v8. Его главный метод — <code>AddStandardResilienceHandler()</code>: одна строка добавляет к клиенту разумно настроенный конвейер из пяти стратегий, от внешней к внутренней:</p>
<ol>
<li><strong>rate limiter</strong> — ограничение одновременных исходящих запросов;</li>
<li><strong>total request timeout</strong> — общий бюджет времени на запрос вместе с повторами (по умолчанию 30 секунд);</li>
<li><strong>retry</strong> — по умолчанию до 3 повторов с экспоненциальной задержкой и jitter, на транзиентные ошибки: 5xx, 408, 429, сетевые исключения, таймаут попытки;</li>
<li><strong>circuit breaker</strong> — размыкается при высокой доле ошибок на окне выборки;</li>
<li><strong>attempt timeout</strong> — таймаут одной попытки (по умолчанию 10 секунд).</li>
</ol>
<pre><code>builder.Services.AddHttpClient&lt;PaymentsClient&gt;(c =&gt; c.BaseAddress = new Uri("https://payments.internal/"))
    .AddStandardResilienceHandler(options =&gt;
    {
        options.AttemptTimeout.Timeout = TimeSpan.FromSeconds(2);
        options.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(8);
        options.Retry.MaxRetryAttempts = 2;
        options.Retry.DisableForUnsafeHttpMethods();     // не повторять POST/PUT/PATCH/DELETE
    });

// Или свой конвейер целиком
builder.Services.AddHttpClient&lt;RatesClient&gt;()
    .AddResilienceHandler("rates", pipeline =&gt; pipeline
        .AddTimeout(TimeSpan.FromSeconds(5))
        .AddRetry(new HttpRetryStrategyOptions { MaxRetryAttempts = 3, UseJitter = true }));</code></pre>
<p>Есть также <code>AddStandardHedgingHandler()</code> для сценариев, где важнее хвостовые задержки, чем нагрузка: при медленном ответе отправляется параллельный запрос, возможно, на другую реплику. Старый пакет <code>Microsoft.Extensions.Http.Polly</code> (с <code>AddPolicyHandler</code> и Polly v7) считается устаревшим вариантом для нового кода.</p>
<blockquote><strong>Важно.</strong> Таймауты должны быть согласованы: <code>HttpClient.Timeout</code> (100 секунд по умолчанию) продолжает действовать поверх конвейера, и если он меньше общего таймаута стратегий, он оборвёт запрос раньше. Таймаут попытки должен быть меньше общего, иначе повторы не успеют выполниться.</blockquote>

<h3>Ретраи без вреда</h3>
<p>Ретраи — самая опасная стратегия, если применять её бездумно:</p>
<ul>
<li><strong>Идемпотентность.</strong> Повтор безопасен, только если операция идемпотентна. GET, PUT, DELETE идемпотентны по семантике, POST — нет: таймаут не означает, что запрос не выполнился, — возможно, платёж прошёл, а потерялся ответ. Повторять неидемпотентные операции можно только с ключом идемпотентности (<code>Idempotency-Key</code>, клиентский id операции), который сервер помнит.</li>
<li><strong>Retry storm.</strong> Если каждый из трёх уровней сервисов делает до 3 попыток (запрос и 2 повтора), нагрузка на нижний уровень в худшем случае умножается в 3³ = 27 раз (при 3 повторах, то есть 4 попытках, — в 64) — ровно тогда, когда он и так перегружен. Повторять стоит на одном уровне, ограничивать число попыток, использовать circuit breaker и jitter.</li>
<li><strong>Что повторять.</strong> Транзиентные ошибки: сетевые, 408, 429 (с учётом <code>Retry-After</code>), 502–504. Не повторять 400, 401, 403, 404, 409 — повтор вернёт то же самое.</li>
<li><strong>Бюджет времени.</strong> Повторы не должны выходить за таймаут, который ждёт ваш собственный клиент: незачем делать третью попытку, если вызывающая сторона уже отвалилась. Отсюда общий таймаут и проброс <code>CancellationToken</code>.</li>
</ul>
<p>Circuit breaker защищает обе стороны: ваш сервис не тратит потоки и соединения на заведомо неудачные вызовы, а упавший сосед получает передышку для восстановления. Важно понимать, что breaker per-instance: каждая реплика решает сама по своей статистике.</p>

<h3>gRPC в ASP.NET Core: основы</h3>
<p><strong>gRPC</strong> — RPC-фреймворк поверх HTTP/2 с контрактом в <strong>protobuf</strong>. Сильные стороны: строгий контракт и генерация клиента и сервера; компактная бинарная сериализация; мультиплексирование вызовов в одном соединении; потоковая передача в обе стороны; встроенные deadlines и отмена. Типичное применение — межсервисное взаимодействие внутри периметра.</p>
<pre><code>// Protos/stock.proto
syntax = "proto3";
option csharp_namespace = "Warehouse.Grpc";
package warehouse;

service Stock {
  rpc GetAvailability (AvailabilityRequest) returns (AvailabilityReply);
  rpc WatchReservations (WatchRequest) returns (stream ReservationEvent);
}

message AvailabilityRequest { string sku = 1; string warehouse_id = 2; }
message AvailabilityReply   { int32 available = 1; int32 reserved = 2; }</code></pre>
<pre><code>&lt;!-- csproj сервера: генерация базового класса --&gt;
&lt;Protobuf Include="Protos/stock.proto" GrpcServices="Server" /&gt;

// Program.cs
builder.Services.AddGrpc();
app.MapGrpcService&lt;StockService&gt;();

public sealed class StockService(IStockQueries queries) : Stock.StockBase
{
    public override async Task&lt;AvailabilityReply&gt; GetAvailability(AvailabilityRequest request, ServerCallContext context)
    {
        var (available, reserved) = await queries.GetAsync(request.Sku, request.WarehouseId, context.CancellationToken);
        return new AvailabilityReply { Available = available, Reserved = reserved };
    }
}</code></pre>
<p>Клиент — сгенерированный класс <code>Stock.StockClient</code> поверх <code>GrpcChannel</code>. Канал дорогой (держит HTTP/2-соединения) и должен переиспользоваться; клиенты дешёвые. В ASP.NET Core удобнее всего клиентская фабрика из пакета <code>Grpc.Net.ClientFactory</code>: <code>builder.Services.AddGrpcClient&lt;Stock.StockClient&gt;(o =&gt; o.Address = new Uri("https://stock.internal"))</code> — она построена на <code>IHttpClientFactory</code> и поддерживает те же handler’ы.</p>
<p>Правила эволюции контракта: номера полей — это контракт на проводе, их <strong>нельзя переиспользовать</strong> и менять; удалённые поля помечают <code>reserved</code>; новые поля добавляются с новыми номерами, и старые клиенты их просто игнорируют. Так protobuf обеспечивает обратную и прямую совместимость без версионирования эндпоинтов.</p>

<h3>gRPC: streaming, deadlines и ошибки</h3>
<p>Четыре вида вызовов: <strong>unary</strong> (запрос — ответ), <strong>server streaming</strong> (запрос — поток ответов), <strong>client streaming</strong> (поток запросов — ответ) и <strong>bidirectional streaming</strong>.</p>
<pre><code>public override async Task WatchReservations(WatchRequest request,
    IServerStreamWriter&lt;ReservationEvent&gt; responseStream, ServerCallContext context)
{
    await foreach (var evt in reservations.SubscribeAsync(request.Sku, context.CancellationToken))
        await responseStream.WriteAsync(evt, context.CancellationToken);
}

// клиент
using var call = client.WatchReservations(new WatchRequest { Sku = "XLR-10" }, cancellationToken: ct);
await foreach (var evt in call.ResponseStream.ReadAllAsync(ct))
    Console.WriteLine(evt.OrderId);</code></pre>
<p><strong>Deadline</strong> — абсолютный момент времени, к которому клиент готов ждать ответ. По умолчанию его <strong>нет</strong>, и зависший вызов будет висеть бесконечно, поэтому deadline ставят на каждый вызов. Он передаётся на сервер в заголовке <code>grpc-timeout</code>; сервер видит его в <code>context.Deadline</code>, а <code>context.CancellationToken</code> срабатывает при наступлении deadline или отмене клиентом. Клиент при превышении получает <code>RpcException</code> со статусом <code>DeadlineExceeded</code>.</p>
<pre><code>try
{
    var reply = await client.GetAvailabilityAsync(request,
        deadline: DateTime.UtcNow.AddSeconds(2),          // обязательно UTC
        cancellationToken: ct);
}
catch (RpcException ex) when (ex.StatusCode == StatusCode.DeadlineExceeded)
{
    // ответа нет за 2 секунды
}

// Пробросить оставшийся deadline входящего вызова в исходящий
builder.Services.AddGrpcClient&lt;Pricing.PricingClient&gt;(o =&gt; o.Address = new Uri("https://pricing.internal"))
    .EnableCallContextPropagation();</code></pre>
<p>Ошибки в gRPC передаются статусами (<code>NotFound</code>, <code>InvalidArgument</code>, <code>FailedPrecondition</code>, <code>Unavailable</code>, <code>Internal</code>...), а не HTTP-кодами: на сервере бросают <code>RpcException(new Status(StatusCode.NotFound, "sku not found"))</code>, необработанное исключение превращается в <code>Unknown</code> без деталей. Повторять имеет смысл в основном <code>Unavailable</code>.</p>
<p>Два частых операционных вопроса. Первый — <strong>HTTP/2 обязателен</strong>: без TLS Kestrel нужно явно настроить endpoint на <code>Http2</code>, а прокси и балансировщики должны его поддерживать. Второй — <strong>балансировка</strong>: HTTP/2-соединение долгоживущее и мультиплексирует все вызовы, поэтому L4-балансировщик (например, обычный Kubernetes Service) прибьёт клиента к одному поду. Нужен L7-балансировщик, понимающий HTTP/2 (Envoy, service mesh), или клиентская балансировка, которую поддерживает <code>Grpc.Net.Client</code>. Для внешних клиентов, которым нужен JSON, есть gRPC JSON transcoding.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Почему нельзя создавать HttpClient на каждый запрос, и почему статический клиент — тоже не идеально?»</summary>
<p>Новый клиент на запрос — это новое TCP-соединение и его закрытие; закрытые сокеты висят в <code>TIME_WAIT</code>, и под нагрузкой заканчиваются локальные порты — socket exhaustion, плюс каждый запрос платит за рукопожатия. Статический клиент переиспользует соединения, но пул живёт вечно, а DNS резолвится только при открытии соединения, поэтому смена IP сервиса не замечается. Решения — <code>SocketsHttpHandler</code> с <code>PooledConnectionLifetime</code> для долгоживущего клиента или <code>IHttpClientFactory</code>, который пулит handler’ы и ротирует их по <code>HandlerLifetime</code>, по умолчанию раз в 2 минуты. В приложении с DI я всегда беру фабрику с typed clients — она ещё даёт handler’ы и стратегии устойчивости.</p>
</details>
<details><summary>«Typed client внедрили в singleton — что не так?»</summary>
<p>Typed client регистрируется как transient и при каждом резолве получает текущий handler из пула. Внедрённый в singleton, он захватывается навсегда вместе со своим handler’ом, ротация перестаёт работать, и возвращается проблема DNS — та же captive dependency, только сетевая. Варианты исправления: внедрять в singleton <code>IHttpClientFactory</code> и создавать клиента на операцию, либо настроить primary handler <code>SocketsHttpHandler</code> с <code>PooledConnectionLifetime</code>, тогда соединения обновляются даже у захваченного клиента. Ещё одна похожая ловушка — <code>DelegatingHandler</code>’ы создаются в своём scope, а не в scope запроса, поэтому данные запроса в них берут через <code>IHttpContextAccessor</code>.</p>
</details>
<details><summary>«Расскажи про standard resilience handler»</summary>
<p>Это метод <code>AddStandardResilienceHandler</code> из <code>Microsoft.Extensions.Http.Resilience</code>, построенный на Polly v8. Он добавляет к HTTP-клиенту пять стратегий от внешней к внутренней: rate limiter, общий таймаут запроса (30 секунд по умолчанию), retry (до трёх повторов, экспонента с jitter, на 5xx, 408, 429 и сетевые ошибки), circuit breaker и таймаут одной попытки (10 секунд). Все параметры настраиваются через options. Я обычно уменьшаю таймауты под реальные SLA соседей и отключаю повторы для небезопасных методов через <code>DisableForUnsafeHttpMethods</code>, если сервер не поддерживает ключи идемпотентности. Нужно помнить, что <code>HttpClient.Timeout</code> продолжает действовать поверх конвейера.</p>
</details>
<details><summary>«Когда ретраи вредны?»</summary>
<p>Когда операция неидемпотентна: таймаут POST не значит, что он не выполнился, и повтор может провести платёж дважды — нужен ключ идемпотентности. Когда ошибка не транзиентная: 400, 404, 409 вернутся снова. Когда повторы на нескольких уровнях перемножаются — retry storm: три уровня по три попытки дают до 27-кратной нагрузки на нижний сервис как раз тогда, когда он перегружен. И когда повтор выходит за бюджет времени вызывающего. Поэтому: ограниченное число попыток, экспонента с jitter, общий таймаут, повторы на одном уровне, circuit breaker и уважение к <code>Retry-After</code>.</p>
</details>
<details><summary>«Как работает circuit breaker?»</summary>
<p>Он считает долю ошибок на окне выборки. В закрытом состоянии вызовы проходят. Если доля ошибок превысила порог при минимальном количестве вызовов, цепь размыкается: вызовы сразу падают с <code>BrokenCircuitException</code>, не доходя до сервиса. Через паузу breaker переходит в half-open и пропускает пробный вызов: успех замыкает цепь, ошибка снова размыкает. Это защищает и наш сервис от траты потоков и соединений на заведомо неудачные вызовы, и упавшего соседа — он получает передышку. Breaker работает в рамках одного процесса, у каждой реплики своя статистика. Его стоит сочетать с fallback или понятной ошибкой для клиента.</p>
</details>
<details><summary>«Что такое deadline в gRPC и почему его надо ставить всегда?»</summary>
<p>Deadline — абсолютный момент, до которого клиент ждёт ответ. По умолчанию его нет, и вызов к зависшему сервису будет висеть бесконечно, держа ресурсы. Клиент задаёт его в UTC, он уходит на сервер в заголовке <code>grpc-timeout</code>, сервер видит <code>context.Deadline</code>, и его <code>CancellationToken</code> срабатывает при наступлении deadline — поэтому сервер должен прокидывать этот токен дальше. Клиент получает <code>RpcException</code> со статусом <code>DeadlineExceeded</code>. В цепочке сервисов deadline стоит пробрасывать: в клиентской фабрике это <code>EnableCallContextPropagation</code>, тогда нижние вызовы не работают дольше, чем ждёт верхний клиент.</p>
</details>
<details><summary>«Почему gRPC плохо балансируется обычным Kubernetes Service?»</summary>
<p>Service балансирует на уровне L4, то есть соединения, а gRPC работает поверх долгоживущего HTTP/2-соединения, в котором мультиплексируются все вызовы. Клиент открывает одно соединение, и все его запросы уходят на один под, остальные простаивают. Решения — L7-балансировщик, понимающий HTTP/2 (Envoy, Linkerd, Istio), или клиентская балансировка: headless Service для получения адресов всех подов и политика round-robin в <code>Grpc.Net.Client</code>. Ещё стоит помнить, что HTTP/2 нужен на всём пути, а без TLS endpoint Kestrel надо явно настроить на <code>Http2</code>.</p>
</details>
<details><summary>«Как эволюционировать protobuf-контракт, не ломая клиентов?»</summary>
<p>Номера полей — это контракт на проводе: их никогда не меняют и не переиспользуют. Новые поля добавляются с новыми номерами — старые клиенты их проигнорируют, а новые клиенты, получив сообщение от старого сервера, увидят значения по умолчанию. Удалённые поля и их имена помечаются <code>reserved</code>, чтобы никто случайно не занял номер. Менять тип поля в общем случае нельзя. Поскольку в proto3 нет различия между «не передано» и «значение по умолчанию» для скаляров, при необходимости используют <code>optional</code> или wrapper-типы. Так эволюционируют без версионирования, по той же схеме expand–contract, что и REST.</p>
</details>`},

    { id: 'perf', title: 'Производительность и наблюдаемость', html: `<h3>Async all the way и thread pool starvation</h3>
<p>ASP.NET Core обслуживает запросы на потоках <strong>пула потоков</strong>. Пока запрос ждёт базу или внешний сервис через <code>await</code>, поток возвращается в пул и обслуживает другие запросы. Так небольшое число потоков держит тысячи одновременных запросов. Принцип <strong>async all the way</strong>: если внизу стека есть ввод-вывод, вся цепочка вызовов до контроллера должна быть асинхронной.</p>
<p>Нарушение этого принципа — <strong>sync over async</strong>: <code>.Result</code>, <code>.Wait()</code>, <code>.GetAwaiter().GetResult()</code> на незавершённой задаче. Поток пула блокируется в ожидании, хотя мог бы работать. Под нагрузкой все потоки оказываются заблокированы, а продолжения тех самых задач, которых они ждут, тоже должны выполниться на пуле — им некуда встать. Пул добавляет потоки, но <strong>постепенно</strong>, а не мгновенно, поэтому система деградирует лавинообразно. Это <strong>thread pool starvation</strong>.</p>
<pre><code>[HttpGet("{id}")]
public IActionResult Get(Guid id)
{
    // Плохо: блокирует поток пула на всё время запроса к базе
    var order = _repository.GetAsync(id).Result;
    return Ok(order);
}

[HttpGet("{id}")]
public async Task&lt;IActionResult&gt; Get(Guid id, CancellationToken ct)
{
    var order = await _repository.GetAsync(id, ct);   // поток свободен, пока ждём
    return Ok(order);
}</code></pre>
<p>Симптомы starvation узнаваемы: время ответа растёт в разы, при этом <strong>CPU низкий</strong>; растёт число потоков процесса и длина очереди пула; health checks начинают таймаутить, и оркестратор перезапускает поды, что только усугубляет картину. Диагностика: <code>dotnet-counters monitor</code> (счётчики <code>ThreadPool Queue Length</code>, <code>ThreadPool Thread Count</code>), затем дамп или <code>dotnet-stack</code> — тысячи потоков с одинаковым стеком в <code>Task.Wait</code> указывают на виновника.</p>
<p>В ASP.NET Core нет <code>SynchronizationContext</code>, поэтому классического дедлока из WinForms и старого ASP.NET при <code>.Result</code> не будет, — но starvation останется. Увеличение <code>ThreadPool.SetMinThreads</code> — временный пластырь, а не лечение. Другие источники блокировок: синхронные API ввода-вывода (<code>File.ReadAllText</code>, синхронное чтение тела запроса, которое Kestrel по умолчанию запрещает), <code>lock</code> вокруг долгих операций, блокирующие клиенты сторонних библиотек.</p>
<blockquote><strong>Важно.</strong> Обратное тоже вредно: <code>Task.Run</code> вокруг синхронного кода в контроллере ничего не ускоряет — вы просто занимаете второй поток пула вместо первого. <code>Task.Run</code> уместен для CPU-работы, которую нужно увести с потока запуска, но не как «превращатель синхронного в асинхронное».</blockquote>

<h3>async void и fire-and-forget в обработчике</h3>
<p>Две ошибки, которые регулярно встречаются на ревью и в вопросах «что не так с этим кодом».</p>
<pre><code>public sealed class OrdersController(AppDbContext db, INotifier notifier) : ControllerBase
{
    [HttpPost("{id}/confirm")]
    public async void Confirm(Guid id)          // 1. async void
    {
        var order = await db.Orders.FindAsync(id);
        order!.Confirm();
        await db.SaveChangesAsync();
    }

    [HttpPost("{id}/ship")]
    public IActionResult Ship(Guid id)
    {
        _ = Task.Run(async () =&gt;                // 2. fire-and-forget со scoped-зависимостью
        {
            await notifier.NotifyAsync(id);
            var order = await db.Orders.FindAsync(id);   // db уже уничтожен вместе с запросом
        });
        return Accepted();
    }
}</code></pre>
<p><strong>async void</strong>: фреймворк не получает задачу и не может её дождаться. Метод возвращает управление на первом <code>await</code>, ASP.NET Core считает действие завершённым и отправляет ответ (пустой 200), пока работа продолжается. Исключение внутри <code>async void</code> некому наблюдать: оно выбрасывается в пул потоков как необработанное и <strong>роняет процесс</strong>. Плюс после окончания запроса scope уничтожается, и <code>db</code> становится disposed. Правило: <code>async void</code> только для обработчиков событий UI, во всём остальном — <code>async Task</code>.</p>
<p><strong>Fire-and-forget</strong> через <code>Task.Run</code>: задача переживает запрос, но зависимости из его scope — нет. <code>DbContext</code> будет освобождён, и получится <code>ObjectDisposedException</code>; исключения задачи никто не залогирует; при остановке приложения работа просто пропадёт. Правильно — положить работу в очередь (channel, outbox, Kafka) и выполнить её в фоновом сервисе со своим scope. Если нужно лишь не ждать долгую операцию, но гарантировать её выполнение, — это как раз сценарий outbox: запись в ту же транзакцию, отправка фоном.</p>

<h3>Response caching и output caching</h3>
<p>В ASP.NET Core два middleware с похожими названиями и разной философией.</p>
<p><strong>Response caching</strong> (<code>AddResponseCaching</code>, <code>UseResponseCaching</code>, атрибут <code>[ResponseCache]</code>) реализует <strong>HTTP-кэширование по стандарту</strong>: решения принимаются по заголовкам <code>Cache-Control</code>, <code>Vary</code> и т.д. Атрибут в основном выставляет заголовки, которые использует и браузер, и CDN, и сам middleware. Следствие: клиент может прислать <code>Cache-Control: no-cache</code>, и middleware обязан пойти мимо кэша; запросы с заголовком <code>Authorization</code> не кэшируются. Для API это малополезно.</p>
<p><strong>Output caching</strong> (.NET 7+) — <strong>серверный</strong> кэш, которым управляет приложение, а не клиент:</p>
<pre><code>builder.Services.AddOutputCache(options =&gt;
{
    options.AddBasePolicy(b =&gt; b.Expire(TimeSpan.FromSeconds(30)));
    options.AddPolicy("catalog", b =&gt; b
        .Expire(TimeSpan.FromMinutes(5))
        .SetVaryByQuery("page", "search")
        .Tag("catalog"));
});

app.UseOutputCache();   // после UseRouting и UseCors

app.MapGet("/v1/catalog", GetCatalog).CacheOutput("catalog");

// Инвалидация по тегу при изменении данных
app.MapPost("/v1/catalog", async (CreateItem cmd, IOutputCacheStore cache, CancellationToken ct) =&gt;
{
    // ... сохранить
    await cache.EvictByTagAsync("catalog", ct);
    return TypedResults.NoContent();
});</code></pre>
<p>Что важно знать про output caching: заголовки клиента его не отключают; есть <strong>теги и инвалидация</strong>; есть защита от <strong>cache stampede</strong> (resource locking) — при промахе только один запрос считает ответ, остальные ждут его; хранилище подменяемое, в .NET 8 появилась реализация на Redis для нескольких экземпляров. По умолчанию кэшируются только GET/HEAD с ответом 200, и <strong>не</strong> кэшируются запросы аутентифицированных пользователей и ответы с <code>Set-Cookie</code> — чтобы не отдать одному пользователю данные другого. В multi-tenant API кэшировать персонализированные ответы можно, только явно варьируя ключ по tenant’у и пользователю, и делать это надо с большой осторожностью.</p>

<h3>HybridCache</h3>
<p>Для кэширования <strong>данных</strong> (а не целых HTTP-ответов) долго было два инструмента: <code>IMemoryCache</code> (в процессе, быстро, но у каждой реплики свой) и <code>IDistributedCache</code> (Redis и т.п., общий, но работает с <code>byte[]</code> и требует ручной сериализации). Оба не защищают от stampede: <code>GetOrCreateAsync</code> у <code>IMemoryCache</code> при одновременном промахе вызовет фабрику во всех конкурирующих запросах.</p>
<p><strong>HybridCache</strong> (пакет <code>Microsoft.Extensions.Caching.Hybrid</code>, появился в экосистеме .NET 9) объединяет оба уровня:</p>
<pre><code>builder.Services.AddHybridCache(options =&gt;
{
    options.DefaultEntryOptions = new HybridCacheEntryOptions
    {
        Expiration = TimeSpan.FromMinutes(10),          // L2 (распределённый)
        LocalCacheExpiration = TimeSpan.FromMinutes(1), // L1 (в памяти процесса)
    };
});
// Если зарегистрирован IDistributedCache (например, AddStackExchangeRedisCache), он станет L2 автоматически

public sealed class ProductNames(HybridCache cache, AppDbContext db)
{
    public ValueTask&lt;string&gt; GetAsync(Guid tenantId, Guid productId, CancellationToken ct) =&gt;
        cache.GetOrCreateAsync(
            $"tenant:{tenantId}:product-name:{productId}",
            async token =&gt; await db.Products.Where(p =&gt; p.Id == productId).Select(p =&gt; p.Name).FirstAsync(token),
            tags: [$"tenant:{tenantId}:products"],
            cancellationToken: ct);
}

// при изменении
await cache.RemoveByTagAsync($"tenant:{tenantId}:products", ct);</code></pre>
<p>Что он даёт: двухуровневый кэш (L1 в памяти, L2 — любой <code>IDistributedCache</code>); <strong>защиту от stampede</strong> — для одного ключа фабрика выполняется один раз, а конкурирующие вызовы ждут её результата; встроенную сериализацию (System.Text.Json по умолчанию, подменяемую); теги для групповой инвалидации; единый API <code>GetOrCreateAsync</code>. Подводный камень — согласованность L1 между репликами: удаление чистит L2 и локальную копию текущего экземпляра, а у других экземпляров L1-копия живёт до своего истечения. Поэтому <code>LocalCacheExpiration</code> делают коротким для данных, где важна свежесть. И, как всегда в multi-tenant системе, tenant — часть ключа.</p>
<blockquote><strong>Важно.</strong> Кэш, который держит объекты, должен держать <strong>сериализуемые неизменяемые данные</strong> (records, DTO), а не сущности EF или объекты с открытыми соединениями: при появлении L2 они пройдут через сериализацию, а мутация закэшированного объекта в L1 незаметно меняет его для всех потребителей.</blockquote>

<h3>Сжатие ответов</h3>
<p>Сжатие (gzip, Brotli) сокращает трафик для текстовых ответов (JSON, HTML) в разы ценой CPU. В ASP.NET Core есть middleware:</p>
<pre><code>builder.Services.AddResponseCompression(options =&gt;
{
    options.EnableForHttps = true;                       // по умолчанию false — см. ниже
    options.Providers.Add&lt;BrotliCompressionProvider&gt;();
    options.Providers.Add&lt;GzipCompressionProvider&gt;();
});
builder.Services.Configure&lt;BrotliCompressionProviderOptions&gt;(o =&gt; o.Level = CompressionLevel.Fastest);

app.UseResponseCompression();   // рано в конвейере, до middleware, которые пишут тело</code></pre>
<p><code>EnableForHttps</code> по умолчанию выключен из-за атак класса CRIME и BREACH: если в одном сжатом ответе смешаны секрет (CSRF-токен) и данные, подконтрольные атакующему, по размеру ответа можно подбирать секрет. Для API с bearer-токенами в заголовке риск обычно ниже, но решение принимают осознанно.</p>
<p>На практике сжатие чаще делают на уровне reverse proxy или CDN (nginx, ingress): там это эффективнее и не тратит CPU приложения. Уже сжатые форматы (изображения, видео, zip) сжимать бессмысленно. Для очень маленьких ответов выигрыш тоже невелик. Уровень сжатия <code>Fastest</code> для динамических ответов почти всегда разумнее <code>Optimal</code>: разница в размере небольшая, а в CPU — заметная.</p>

<h3>Rate limiting</h3>
<p>С .NET 7 в ASP.NET Core встроено middleware ограничения частоты запросов (<code>Microsoft.AspNetCore.RateLimiting</code>) поверх абстракций <code>System.Threading.RateLimiting</code>. Четыре алгоритма:</p>
<ul>
<li><strong>Fixed window</strong> — N запросов за окно фиксированной длины; просто, но на стыке окон возможен двойной всплеск;</li>
<li><strong>Sliding window</strong> — окно разбито на сегменты, всплеск на стыке сглажен;</li>
<li><strong>Token bucket</strong> — ведро пополняется с постоянной скоростью, допускает короткие всплески до ёмкости ведра;</li>
<li><strong>Concurrency</strong> — ограничивает не частоту, а число одновременно выполняющихся запросов.</li>
</ul>
<pre><code>builder.Services.AddRateLimiter(options =&gt;
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;   // по умолчанию 503!

    options.AddPolicy("per-user", httpContext =&gt;
        RateLimitPartition.GetTokenBucketLimiter(
            partitionKey: httpContext.User.FindFirst("sub")?.Value
                          ?? httpContext.Connection.RemoteIpAddress?.ToString() ?? "anonymous",
            factory: _ =&gt; new TokenBucketRateLimiterOptions
            {
                TokenLimit = 20,
                TokensPerPeriod = 10,
                ReplenishmentPeriod = TimeSpan.FromSeconds(1),
                QueueLimit = 0,
            }));

    options.OnRejected = (context, ct) =&gt;
    {
        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
            context.HttpContext.Response.Headers.RetryAfter = ((int)retryAfter.TotalSeconds).ToString();
        return ValueTask.CompletedTask;
    };
});

app.UseRateLimiter();   // после UseRouting (для политик эндпоинтов) и после аутентификации, если ключ — пользователь
app.MapPost("/v1/orders", CreateOrder).RequireRateLimiting("per-user");</code></pre>
<p>Ключевые моменты: <strong>партиционирование</strong> — лимит считается отдельно для каждого ключа (пользователь, tenant, IP, API-ключ); статус отказа по умолчанию — 503, и его почти всегда меняют на 429; лимитер хранит состояние <strong>в памяти процесса</strong>, то есть при пяти репликах реальный лимит в пять раз выше, и для строгого распределённого лимита нужен Redis или лимит на шлюзе. Rate limiting в приложении — это защита ресурса от перегрузки и от одного шумного клиента, а не замена защиты на периметре (WAF, ingress).</p>

<h3>Память и аллокации</h3>
<p>Сборщик мусора в .NET быстрый, но аллокации на горячем пути всё равно стоят: каждая — работа GC, а частые сборки поколения 2 дают паузы и рост латентности p99. Основные приёмы для веб-сервиса:</p>
<ul>
<li><strong>Не буферизовать большие данные.</strong> Выгрузку на сотни тысяч строк отдавать потоком: <code>IAsyncEnumerable&lt;T&gt;</code> из EF Core сериализуется System.Text.Json по мере чтения, вместо <code>ToListAsync</code> целиком в память.</li>
<li><strong>Large Object Heap.</strong> Объекты от 85 000 байт попадают в LOH, который собирается только вместе с поколением 2. Большие временные массивы — повод для <code>ArrayPool&lt;T&gt;.Shared</code> или <code>RecyclableMemoryStream</code>.</li>
<li><strong><code>Span&lt;T&gt;</code>, <code>Memory&lt;T&gt;</code>, <code>stackalloc</code></strong> для разбора строк и буферов без промежуточных копий; <code>string.Create</code> и интерполированные строки с обработчиками вместо конкатенации в циклах.</li>
<li><strong>System.Text.Json source generation</strong> (<code>JsonSerializerContext</code>) убирает рефлексию и ускоряет сериализацию, а для Native AOT обязательна.</li>
<li><strong>Логирование без аллокаций</strong>: <code>[LoggerMessage]</code> вместо интерполяции (см. ниже).</li>
<li><strong>EF Core</strong>: <code>AsNoTracking</code> для чтения, проекции в DTO вместо загрузки сущностей целиком, пагинация.</li>
</ul>
<p>ASP.NET Core по умолчанию работает с <strong>Server GC</strong> — отдельная куча и поток сборки на ядро, высокая пропускная способность ценой большего потребления памяти. В контейнерах с ограничением памяти это стоит учитывать; в .NET 9 для Server GC по умолчанию включён режим DATAS, который динамически подстраивает число куч под нагрузку и уменьшает потребление памяти. Главное правило — <strong>сначала измерить</strong>: BenchmarkDotNet для микро-оптимизаций, <code>dotnet-counters</code> (аллокации в секунду, время в GC), <code>dotnet-trace</code> и профилировщик для реальной картины. Оптимизация без профиля обычно ускоряет не то.</p>

<h3>OpenTelemetry: traces, metrics, logs</h3>
<p><strong>Observability</strong> держится на трёх сигналах: <strong>трейсы</strong> (путь одного запроса через сервисы, с длительностью каждого шага), <strong>метрики</strong> (агрегаты во времени: RPS, латентность, ошибки, размер очередей) и <strong>логи</strong> (события с контекстом). <strong>OpenTelemetry</strong> — вендор-нейтральный стандарт и SDK: инструментируете приложение один раз, экспортируете по протоколу OTLP в любой бэкенд — Jaeger, Tempo, Prometheus, Grafana, Elastic, облачные APM.</p>
<p>В .NET OpenTelemetry опирается на встроенные API: <code>System.Diagnostics.Activity</code> — это span, <code>ActivitySource</code> — источник span’ов; <code>System.Diagnostics.Metrics.Meter</code> с инструментами <code>Counter&lt;T&gt;</code>, <code>Histogram&lt;T&gt;</code>, <code>UpDownCounter&lt;T&gt;</code>; логи — обычный <code>ILogger</code>. Сам код приложения от OpenTelemetry почти не зависит.</p>
<pre><code>builder.Services.AddOpenTelemetry()
    .ConfigureResource(r =&gt; r.AddService("warehouse-api"))
    .WithTracing(t =&gt; t
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddSource("Warehouse.Orders"))          // наши собственные span’ы
    .WithMetrics(m =&gt; m
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddRuntimeInstrumentation()
        .AddMeter("Warehouse.Orders"))
    .UseOtlpExporter();                           // адрес — из OTEL_EXPORTER_OTLP_ENDPOINT

builder.Logging.AddOpenTelemetry(o =&gt; o.IncludeScopes = true);

public sealed class ReservationService
{
    private static readonly ActivitySource Source = new("Warehouse.Orders");
    private static readonly Meter Meter = new("Warehouse.Orders");
    private static readonly Counter&lt;long&gt; Reserved = Meter.CreateCounter&lt;long&gt;("warehouse.reservations");

    public async Task ReserveAsync(Guid orderId, CancellationToken ct)
    {
        using var activity = Source.StartActivity("Reserve");   // null, если никто не слушает
        activity?.SetTag("order.id", orderId);
        // ...
        Reserved.Add(1, new KeyValuePair&lt;string, object?&gt;("warehouse", "main"));
    }
}</code></pre>
<p>Контекст трейса передаётся между сервисами заголовком W3C <code>traceparent</code>: ASP.NET Core читает его на входе, <code>HttpClient</code> и gRPC-клиент добавляют на выходе автоматически. Для Kafka автоматики в стандартном клиенте нет — <code>traceparent</code> кладут в заголовки сообщения при публикации и восстанавливают родительский контекст в консьюмере, иначе трейс обрывается на брокере. С .NET 8 ASP.NET Core сам публикует метрики по семантическим соглашениям OpenTelemetry, например <code>http.server.request.duration</code>.</p>
<p>Две вещи, о которых спрашивают на senior-уровне. <strong>Сэмплирование</strong>: писать 100% трейсов под нагрузкой дорого; head sampling (решение в начале запроса) дёшев, но может выбросить интересный ошибочный запрос; tail sampling в OpenTelemetry Collector решает после завершения трейса и сохраняет все ошибки и медленные запросы. <strong>Кардинальность метрик</strong>: тег с идентификатором пользователя или заказа превращает одну метрику в миллионы временных рядов и кладёт Prometheus. Идентификаторы — в трейсы и логи, в метрики — только ограниченные по значениям измерения.</p>

<h3>Structured logging и LoggerMessage</h3>
<p>Обычные методы <code>LogInformation(template, params object[] args)</code> на каждый вызов создают массив аргументов, упаковывают value types (боксинг <code>int</code>, <code>Guid</code>), разбирают шаблон (с кэшем) — и всё это даже если уровень отключён, кроме случаев, когда вы проверили <code>IsEnabled</code> вручную. На горячем пути это заметные аллокации.</p>
<p>Source generator <strong><code>[LoggerMessage]</code></strong> (с .NET 6) генерирует строго типизированный метод: шаблон разбирается на этапе компиляции, проверка уровня встроена, параметры передаются без боксинга и без массива:</p>
<pre><code>public static partial class Log
{
    [LoggerMessage(EventId = 1001, Level = LogLevel.Information,
        Message = "Order {OrderId} reserved in {ElapsedMs} ms")]
    public static partial void OrderReserved(ILogger logger, Guid orderId, long elapsedMs);

    [LoggerMessage(EventId = 1002, Level = LogLevel.Warning,
        Message = "Reservation for order {OrderId} failed: {Reason}")]
    public static partial void ReservationFailed(ILogger logger, Guid orderId, string reason, Exception exception);
}

Log.OrderReserved(logger, order.Id, sw.ElapsedMilliseconds);</code></pre>
<p>Бонусы: стабильные <code>EventId</code>, по которым удобно настраивать алерты; ошибки в шаблоне (несовпадение параметров) ловятся компилятором; все сообщения сервиса собраны в одном месте. Исключение передаётся отдельным параметром <code>Exception</code> — генератор распознаёт его и не превращает в поле шаблона.</p>
<p>Правила structured logging, которые стоит проговорить на собеседовании: постоянный шаблон с именованными полями; имена полей единообразны во всех сервисах (<code>OrderId</code>, а не то <code>orderId</code>, то <code>Order</code>); контекст через scopes; уровни по смыслу — Error для того, что требует внимания человека, Warning для деградации, Information для бизнес-событий, Debug для отладки; никаких секретов и персональных данных.</p>

<h3>Корреляция: ProblemDetails, traceId и логи</h3>
<p>Пользователь видит ошибку и пишет в поддержку. Чтобы найти, что произошло, нужна <strong>связка</strong> между ответом и телеметрией. Её обеспечивает идентификатор трейса:</p>
<ul>
<li>ASP.NET Core создаёт <code>Activity</code> на каждый входящий запрос (или продолжает пришедший <code>traceparent</code>);</li>
<li>логи, записанные во время запроса, содержат <code>TraceId</code> и <code>SpanId</code> — провайдер OpenTelemetry прикладывает их автоматически, для консоли это включается <code>ActivityTrackingOptions</code>;</li>
<li>ответ об ошибке в формате ProblemDetails содержит поле <code>traceId</code> — его можно показать пользователю или отправить в отчёт об ошибке фронтенда;</li>
<li>по этому значению в системе трейсов открывается весь путь запроса через все сервисы, а в логах — все записи с этим <code>TraceId</code>.</li>
</ul>
<pre><code>builder.Services.AddProblemDetails(o =&gt; o.CustomizeProblemDetails = ctx =&gt;
{
    ctx.ProblemDetails.Extensions["traceId"] = Activity.Current?.TraceId.ToString() ?? ctx.HttpContext.TraceIdentifier;
});

// Ответ клиенту:
// { "title": "Internal Server Error", "status": 500, "traceId": "4bf92f3577b34da6a3ce929d0e0e4736" }</code></pre>
<p>Если кроме W3C-трейсинга в системе исторически используется собственный <code>X-Correlation-Id</code>, его стоит не заменять, а связать: класть в scope логов и в тег span’а, возвращать в заголовке ответа. Тогда старые инструменты продолжат работать, а новые — получат полноценные трейсы.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Что такое thread pool starvation, как её распознать и чем лечить?»</summary>
<p>Это ситуация, когда все потоки пула заблокированы, обычно из-за sync over async — <code>.Result</code> или <code>.Wait()</code> на задачах ввода-вывода. Продолжения этих задач тоже ждут потока пула, а пул добавляет потоки постепенно, поэтому сервис деградирует лавинообразно. Признаки: латентность растёт в разы при низком CPU, растёт число потоков и очередь пула, начинают таймаутить health checks. Диагностирую через <code>dotnet-counters</code>, затем дамп или <code>dotnet-stack</code>, где видно множество потоков в <code>Wait</code>. Лечение — убрать блокировки и сделать цепочку асинхронной до конца; <code>SetMinThreads</code> — только временный пластырь. В ASP.NET Core нет <code>SynchronizationContext</code>, поэтому дедлока нет, но starvation есть.</p>
</details>
<details><summary>«Чем output caching отличается от response caching?»</summary>
<p>Response caching реализует HTTP-кэширование по стандарту: решения по заголовкам <code>Cache-Control</code>, и клиент может его обойти, прислав <code>no-cache</code>; для API пользы мало. Output caching из .NET 7 — серверный кэш под управлением приложения: политики, вариации по query и заголовкам, теги и <code>EvictByTagAsync</code> для инвалидации, защита от stampede, подменяемое хранилище с Redis-реализацией в .NET 8. По умолчанию он кэширует только GET/HEAD с 200 и не кэширует аутентифицированные запросы и ответы с cookies, чтобы не смешать данные пользователей. Для данных внутри приложения я скорее возьму HybridCache, чем кэш целых ответов.</p>
</details>
<details><summary>«Зачем HybridCache, если есть IMemoryCache и IDistributedCache?»</summary>
<p>Он объединяет оба уровня: L1 в памяти процесса и L2 — любой <code>IDistributedCache</code>, например Redis, с единым API <code>GetOrCreateAsync</code> и встроенной сериализацией. Главное — защита от cache stampede: для одного ключа фабрика выполняется один раз, а конкурирующие вызовы ждут её результата, тогда как <code>IMemoryCache.GetOrCreateAsync</code> вызовет фабрику во всех одновременных запросах. Есть теги для групповой инвалидации. Ограничение — локальные копии на других репликах не инвалидируются мгновенно, поэтому L1 делаю коротким. Кэширую неизменяемые сериализуемые DTO, а в multi-tenant системе tenant всегда часть ключа.</p>
</details>
<details><summary>«Как настроить rate limiting и какие у встроенного решения ограничения?»</summary>
<p><code>AddRateLimiter</code> с политиками и <code>UseRateLimiter</code> в конвейере, политики привязываются к эндпоинтам через <code>RequireRateLimiting</code> или атрибут. Алгоритмы: fixed window, sliding window, token bucket и concurrency. Почти всегда использую партиционирование по пользователю, tenant’у или IP, чтобы один клиент не съедал лимит всех. Первое, что меняю, — <code>RejectionStatusCode</code> на 429, потому что по умолчанию 503, и в <code>OnRejected</code> выставляю <code>Retry-After</code>. Главное ограничение — состояние в памяти процесса: при N репликах фактический лимит в N раз выше, поэтому строгие лимиты делаются на шлюзе или через распределённое хранилище. Если ключ — пользователь, middleware должно стоять после аутентификации.</p>
</details>
<details><summary>«Что не так с async void в контроллере или с Task.Run внутри запроса?»</summary>
<p>С <code>async void</code> фреймворк не получает задачу: действие считается завершённым на первом <code>await</code>, ответ уходит раньше, чем работа закончилась, а исключение некому наблюдать, и оно роняет процесс. Плюс scope запроса уничтожается, и <code>DbContext</code> становится disposed посреди работы. Fire-and-forget через <code>Task.Run</code> со scoped-зависимостями приводит к тому же <code>ObjectDisposedException</code>, исключения теряются, а при остановке работа пропадает. Правильно — <code>async Task</code> во всём, кроме UI-обработчиков событий, а отложенную работу класть в очередь — channel, outbox или брокер — и выполнять в фоновом сервисе со своим scope.</p>
</details>
<details><summary>«Как ты организуешь observability сервиса?»</summary>
<p>OpenTelemetry с экспортом по OTLP: трейсы с инструментированием ASP.NET Core, HttpClient, базы и собственных <code>ActivitySource</code> на бизнес-операциях; метрики — встроенные HTTP-метрики, runtime и свои <code>Meter</code> с счётчиками и гистограммами; логи через <code>ILogger</code> с экспортом в тот же конвейер, чтобы в каждой записи был <code>TraceId</code>. Контекст между сервисами — W3C <code>traceparent</code>, для Kafka — вручную в заголовках сообщения. Для трейсов — сэмплирование, лучше tail sampling в коллекторе, чтобы сохранять все ошибки и медленные запросы. В метриках слежу за кардинальностью: никаких идентификаторов в тегах. В ответах об ошибках возвращаю <code>traceId</code>, чтобы поддержка находила запрос за секунды.</p>
</details>
<details><summary>«Зачем нужен [LoggerMessage], если есть logger.LogInformation?»</summary>
<p>Обычные методы на каждый вызов создают массив <code>params object[]</code>, упаковывают value types и делают это даже при выключенном уровне, если не проверить <code>IsEnabled</code> вручную. Source generator <code>[LoggerMessage]</code> генерирует строго типизированный метод: шаблон разбирается при компиляции, проверка уровня встроена, параметры передаются без боксинга и аллокаций. Ошибки в шаблоне ловит компилятор, у сообщений стабильные <code>EventId</code> для алертов, и все сообщения сервиса собраны в одном месте. Для холодного кода разница несущественна, но на горячих путях — обработка каждого сообщения Kafka, каждого запроса — она заметна в аллокациях и, как следствие, в работе GC.</p>
</details>
<details><summary>«Сервис потребляет всё больше памяти. С чего начнёшь?»</summary>
<p>Сначала отличу утечку от нормального поведения Server GC, который охотно держит память: смотрю <code>dotnet-counters</code> — размер куч по поколениям, LOH, частоту сборок, аллокации в секунду — и тренд после сборок поколения 2. Если после полных сборок память растёт — снимаю два дампа с интервалом и сравниваю, какие типы прибавились и кто их держит (корни). Типичные причины в веб-сервисах: кэш без ограничения размера или времени жизни, статические коллекции, подписки на события без отписки, transient disposable из корневого провайдера, долгоживущий <code>DbContext</code> с растущим change tracker’ом, буферизация больших ответов. Для контейнера проверяю лимиты памяти и при необходимости ограничиваю кучу GC.</p>
</details>`},

  ],
  questions: [
    { id: 'asp-001', chapter: 'hosting', type: 'choice',
      q: `Ключ <code>Kafka:GroupId</code> задан в четырёх местах: <code>appsettings.json</code> = <code>a</code>, <code>appsettings.Production.json</code> = <code>b</code>, переменная окружения <code>Kafka__GroupId</code> = <code>c</code>, аргумент командной строки <code>--Kafka:GroupId=d</code>. Приложение собрано через <code>WebApplication.CreateBuilder(args)</code> и запущено в Production. Какое значение получит приложение?`,
      options: [`<code>a</code> — базовый файл всегда главный`, `<code>b</code> — файл окружения важнее всего`, `<code>c</code> — переменные окружения перекрывают всё`, `<code>d</code> — командная строка добавлена последней`],
      answer: 3,
      explain: `Провайдеры конфигурации применяются по порядку, и каждый следующий перекрывает предыдущие: JSON, JSON окружения, user secrets (только Development), переменные окружения, командная строка. Командная строка добавляется последней, поэтому побеждает <code>d</code>. Соблазнительный ответ «переменные окружения» верен, только если аргумент командной строки не передан: в контейнерах аргументы редко используются, отсюда и ощущение, что env — «самый главный».` },

    { id: 'asp-002', chapter: 'hosting', type: 'choice',
      q: `В конструктор <code>BackgroundService</code> внедрили <code>IOptionsSnapshot&lt;KafkaOptions&gt;</code>. Что произойдёт при запуске в окружении Development?`,
      options: [`Всё работает, значение обновляется при изменении файла`, `Всё работает, но значение никогда не обновится`, `Исключение: scoped-сервис нельзя потреблять из singleton`, `Ошибка компиляции: интерфейс нельзя внедрять в hosted service`],
      answer: 2,
      explain: `<code>IOptionsSnapshot</code> зарегистрирован как scoped, а hosted service — singleton. В Development у <code>WebApplication</code> включён <code>ValidateScopes</code>, поэтому контейнер бросит <code>InvalidOperationException</code> «Cannot consume scoped service ... from singleton». Вариант «работает, но не обновляется» описывает, что было бы с выключенной проверкой (захваченный snapshot навсегда), — именно поэтому проверка и существует. Для singleton правильный выбор — <code>IOptionsMonitor</code>.` },

    { id: 'asp-003', chapter: 'hosting', type: 'choice',
      q: `Зачем к <code>AddOptions&lt;T&gt;().ValidateDataAnnotations()</code> добавляют <code>.ValidateOnStart()</code>?`,
      options: [`Чтобы валидация выполнилась при запуске хоста, а не при первом обращении к <code>Value</code>`, `Чтобы валидация повторялась при каждом изменении конфигурации`, `Без него атрибуты DataAnnotations вообще не проверяются`, `Чтобы ошибки валидации логировались, а не бросались`],
      answer: 0,
      explain: `Валидация options по умолчанию ленивая: <code>OptionsValidationException</code> вылетит при первом обращении к <code>.Value</code>, возможно, через час работы в середине запроса. <code>ValidateOnStart</code> переносит проверку на старт хоста — приложение с неверной конфигурацией просто не запустится, и это видно при деплое. Атрибуты проверяются и без него (просто позже), а повторная валидация при перезагрузке происходит через <code>IOptionsMonitor</code> независимо от этого вызова.` },

    { id: 'asp-004', chapter: 'hosting', type: 'choice',
      q: `Переменные <code>ASPNETCORE_ENVIRONMENT</code> и <code>DOTNET_ENVIRONMENT</code> не заданы. В каком окружении запустится приложение?`,
      options: [`Development`, `Production`, `Staging`, `Окружение не определено, <code>IsDevelopment()</code> и <code>IsProduction()</code> вернут false`],
      answer: 1,
      explain: `Значение по умолчанию — Production. Это осознанный выбор безопасности: если переменную забыли выставить на сервере, приложение не покажет Developer Exception Page со стектрейсами и не подключит user secrets. Многие думают, что по умолчанию Development, потому что локально его выставляет <code>launchSettings.json</code> — но это настройка профиля запуска IDE, а не фреймворка.` },

    { id: 'asp-005', chapter: 'hosting', type: 'open',
      q: `Расскажи, что происходит от вызова <code>WebApplication.CreateBuilder(args)</code> до момента, когда Kestrel начинает принимать запросы.`,
      answer: `<p>Builder определяет окружение и content root, собирает host-конфигурацию (переменные <code>ASPNETCORE_</code>/<code>DOTNET_</code>, аргументы), затем конфигурацию приложения — JSON, JSON окружения, user secrets в Development, env, командную строку. Настраивается логирование, регистрируются сервисы фреймворка.</p>
<p>Дальше я регистрирую свои сервисы в <code>builder.Services</code> — это только описания. <code>Build()</code> строит <code>ServiceProvider</code>; в Development здесь же срабатывают <code>ValidateOnBuild</code> и <code>ValidateScopes</code>. После этого коллекция сервисов read-only.</p>
<p>Вызовы <code>Use*</code> и <code>Map*</code> лишь собирают конвейер. <code>Run()</code> вызывает <code>StartAsync</code> хоста: по очереди стартуют hosted services, конвейер компилируется в один <code>RequestDelegate</code>, Kestrel открывает порты, срабатывает <code>ApplicationStarted</code>. С <code>ValidateOnStart</code> на старте проверяются options. Отсюда практический вывод: всё, что блокирует <code>StartAsync</code> hosted service, задерживает и приём запросов.</p>` },

    { id: 'asp-006', chapter: 'hosting', type: 'open',
      q: `Как ты организуешь конфигурацию сервиса для локальной разработки, staging и production, включая секреты?`,
      answer: `<p>Значения по умолчанию, безопасные и несекретные, лежат в <code>appsettings.json</code>; различия окружений — в <code>appsettings.{Environment}.json</code>, но их стараюсь держать минимальными. Локальные секреты — в user secrets, которые подключаются только в Development и не попадают в репозиторий.</p>
<p>В staging и production всё окружение-специфичное приходит переменными окружения из секретов Kubernetes или из Vault/Key Vault отдельным провайдером, иерархия через двойное подчёркивание. Каждая секция привязана к классу options с валидацией и <code>ValidateOnStart</code>, так что ошибка конфигурации ломает деплой, а не запросы.</p>
<p>В коде никакого чтения <code>IConfiguration</code> строками и минимум веток <code>if (IsProduction())</code>: различия выражаются конфигурацией, иначе они не тестируются нигде, кроме продакшена. Секреты не логирую, а при старте могу залогировать нечувствительные ключевые параметры, чтобы было видно, с чем сервис запустился.</p>` },

    { id: 'asp-007', chapter: 'hosting', type: 'choice',
      q: `Что произойдёт при выполнении этого кода?<pre><code>var app = builder.Build();
builder.Services.AddSingleton&lt;IClock, SystemClock&gt;();
app.MapGet("/now", (IClock clock) =&gt; clock.Now);
app.Run();</code></pre>`,
      options: [`Работает: регистрация попадёт в контейнер при первом запросе`, `Работает, но <code>IClock</code> будет transient`, `Эндпоинт вернёт 500, потому что сервис не найден`, `Исключение при <code>AddSingleton</code>: коллекция сервисов уже read-only`],
      answer: 3,
      explain: `После <code>Build()</code> коллекция сервисов становится только для чтения, и попытка добавить регистрацию бросает <code>InvalidOperationException</code> сразу, на строке <code>AddSingleton</code>. Вариант «500 при запросе» выглядит логично — сервиса ведь в контейнере нет, — но до запроса дело не дойдёт. Граница <code>Build()</code>: до неё регистрация, после — использование.` },

    { id: 'asp-008', chapter: 'middleware', type: 'choice',
      q: `Что не так с этим конвейером?<pre><code>app.UseRouting();
app.UseAuthorization();
app.UseAuthentication();
app.MapControllers(); // контроллеры помечены [Authorize]</code></pre>`,
      options: [`Ничего: порядок аутентификации и авторизации не важен`, `Все запросы к <code>[Authorize]</code>-эндпоинтам получат 401 даже с валидным токеном`, `Приложение не стартует: фреймворк проверяет порядок`, `Запросы пройдут без проверки прав, так как авторизация уже отработала`],
      answer: 1,
      explain: `Авторизация выполняется раньше аутентификации и видит анонимного пользователя: <code>HttpContext.User</code> ещё не заполнен. Для эндпоинта с <code>[Authorize]</code> это Challenge, и bearer-схема отвечает 401. Вариант «пройдут без проверки» опасно правдоподобен, но авторизация не пропускает анонима — она отказывает. Проверки порядка при старте нет: это ловится только тестами или ревью.` },

    { id: 'asp-009', chapter: 'middleware', type: 'choice',
      q: `Что выведет запрос <code>GET /anything</code>?<pre><code>app.Use(async (ctx, next) =&gt; { await ctx.Response.WriteAsync("A"); await next(ctx); });
app.Run(ctx =&gt; ctx.Response.WriteAsync("B"));
app.Use(async (ctx, next) =&gt; { await ctx.Response.WriteAsync("C"); await next(ctx); });</code></pre>`,
      options: [`<code>AB</code>`, `<code>ABC</code>`, `<code>AC</code>`, `<code>B</code>`],
      answer: 0,
      explain: `Первое middleware пишет «A» и вызывает следующее. <code>Run</code> — терминальное звено: оно пишет «B» и не получает <code>next</code>, поэтому всё зарегистрированное после него недостижимо. «ABC» получилось бы, если бы <code>Run</code> вёл себя как <code>Use</code>, — частая ошибка при чтении кода.` },

    { id: 'asp-010', chapter: 'middleware', type: 'choice',
      q: `Нужно подключить middleware определения tenant’а только для путей <code>/api/*</code>, а затем продолжить общий конвейер (авторизация, эндпоинты). Что использовать?`,
      options: [`<code>app.Map("/api", b =&gt; b.UseMiddleware&lt;TenantMiddleware&gt;())</code>`, `<code>app.MapWhen(ctx =&gt; ..., b =&gt; b.UseMiddleware&lt;TenantMiddleware&gt;())</code>`, `<code>app.UseWhen(ctx =&gt; ctx.Request.Path.StartsWithSegments("/api"), b =&gt; b.UseMiddleware&lt;TenantMiddleware&gt;())</code>`, `<code>app.MapGroup("/api").UseMiddleware&lt;TenantMiddleware&gt;()</code>`],
      answer: 2,
      explain: `<code>UseWhen</code> создаёт условную ветку, которая после выполнения возвращается в основной конвейер. <code>Map</code> и <code>MapWhen</code> создают ветки, которые в основной конвейер не возвращаются: всё, что зарегистрировано после них, для <code>/api</code> не выполнится, и ветке нужен свой терминальный обработчик. У <code>MapGroup</code> нет метода <code>UseMiddleware</code> — группе маршрутов добавляют endpoint filters, а не middleware.` },

    { id: 'asp-011', chapter: 'middleware', type: 'choice',
      q: `SPA с другого домена шлёт CORS preflight (<code>OPTIONS</code> без токена) к API с FallbackPolicy «только аутентифицированные». Где должен стоять <code>UseCors</code>, чтобы preflight проходил?`,
      options: [`В самом конце, после <code>MapControllers</code>`, `После <code>UseAuthorization</code>`, `Где угодно: авторизация сама пропускает <code>OPTIONS</code>-запросы без проверки`, `После <code>UseRouting</code>, до <code>UseAuthentication</code> и <code>UseAuthorization</code>`],
      answer: 3,
      explain: `CORS middleware должно видеть выбранный эндпоинт (политику из его метаданных), значит, после маршрутизации, и обработать preflight до того, как авторизация потребует токен. Жёсткое требование документации — <code>UseCors</code> до <code>UseAuthorization</code>; рекомендуемое место — сразу после <code>UseRouting</code>, до аутентификации. Если поставить его после авторизации, preflight без токена получит 401, и браузер заблокирует реальный запрос: сама авторизация для preflight исключений не делает. Регистрация после эндпоинтов вообще не выполнится для обработанных запросов.` },

    { id: 'asp-012', chapter: 'middleware', type: 'open',
      q: `Напиши middleware, которое измеряет время обработки запроса и возвращает его в заголовке <code>Server-Timing</code>. Какие подводные камни?`,
      answer: `<p>Главный камень — заголовки нельзя менять после начала ответа: если поставить заголовок после <code>await next(context)</code>, а эндпоинт уже записал тело, будет <code>InvalidOperationException</code>. Поэтому заголовок добавляется в колбэке <code>OnStarting</code>, который выполняется прямо перед отправкой заголовков.</p>
<pre><code>public sealed class TimingMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var start = Stopwatch.GetTimestamp();
        context.Response.OnStarting(() =&gt;
        {
            var ms = Stopwatch.GetElapsedTime(start).TotalMilliseconds;
            context.Response.Headers["Server-Timing"] = $"app;dur={ms:F1}";
            return Task.CompletedTask;
        });
        await next(context);
    }
}</code></pre>
<p>Нюансы: время в заголовке — это время до начала ответа, а не до его полной отправки; для полного времени нужен лог после <code>next</code>. Middleware создаётся один раз — никакого состояния запроса в полях. Ставить его стоит рано, чтобы измерение покрывало остальной конвейер. И в продакшене стоит подумать, не раскрывает ли заголовок лишнего; для метрик правильнее гистограмма OpenTelemetry, а встроенная <code>http.server.request.duration</code> уже есть.</p>` },

    { id: 'asp-013', chapter: 'middleware', type: 'open',
      q: `Почему обработчик исключений ставят первым в конвейере и что он может сделать, если ответ уже начал отправляться?`,
      answer: `<p>Middleware оборачивает только то, что зарегистрировано после него: исключение, выброшенное звеном, поднимается по цепочке вызовов <code>next</code> к внешним звеньям. Чтобы любое исключение — из маршрутизации, аутентификации, ваших middleware и эндпоинтов — превратилось в стандартный ProblemDetails, обработчик должен быть самым внешним; перед ним уместен разве что forwarded headers.</p>
<p>Если ответ уже начался (<code>Response.HasStarted</code>) — например, при стриминге или если эндпоинт успел сбросить часть тела, — статус и заголовки уже ушли клиенту. Подменить ответ на 500 с ProblemDetails невозможно. Обработчик может только залогировать исключение и прервать соединение, чтобы клиент не принял обрезанный ответ за полный. Поэтому в стриминговых эндпоинтах ошибки стоит обрабатывать внутри, сигнализируя о них форматом потока, а не надеяться на глобальный обработчик.</p>` },

    { id: 'asp-014', chapter: 'middleware', type: 'open',
      q: `Чем middleware отличается от фильтра MVC или endpoint filter, и как выбрать?`,
      answer: `<p>Middleware работает на уровне HTTP для всех запросов: он видит <code>HttpContext</code> и, после маршрутизации, выбранный эндпоинт с метаданными, но ничего не знает об аргументах действия и результате биндинга. Он выполняется и для статики, health checks, gRPC, 404.</p>
<p>Фильтры MVC и endpoint filters работают внутри выполнения конкретного эндпоинта: видят привязанные аргументы, <code>ModelState</code>, результат действия, могут подменить результат. Они применяются выборочно — глобально для MVC, на контроллер, действие или группу маршрутов.</p>
<p>Выбор: сквозное и не зависящее от действия — корреляция, заголовки безопасности, обработка исключений, определение tenant’а, rate limiting — в middleware. То, что зависит от аргументов или результата, — валидация DTO, аудит конкретных команд, преобразование результата, проверка ресурса из аргумента — в фильтр. В MediatR-архитектуре многое из второго уходит в pipeline behaviors, и тогда правило работает одинаково для HTTP и для команд из консьюмера Kafka.</p>` },

    { id: 'asp-015', chapter: 'di', type: 'choice',
      q: `Что произойдёт с этим кодом в окружении Development?<pre><code>builder.Services.AddDbContext&lt;AppDbContext&gt;(o =&gt; o.UseNpgsql(cs));
builder.Services.AddSingleton&lt;StockCache&gt;();

public sealed class StockCache(AppDbContext db)
{
    public Task&lt;int&gt; GetAsync(Guid sku) =&gt; db.Stock.Where(s =&gt; s.Sku == sku).SumAsync(s =&gt; s.Quantity);
}</code></pre>`,
      options: [`Ошибка контейнера: scoped <code>AppDbContext</code> нельзя внедрить в singleton`, `Всё работает: EF Core сам делает <code>DbContext</code> потокобезопасным`, `Работает, но каждый вызов создаёт новый <code>DbContext</code>`, `Ошибка компиляции: primary constructor несовместим с DI`],
      answer: 0,
      explain: `<code>AddDbContext</code> регистрирует контекст как scoped, а <code>StockCache</code> — singleton. Это captive dependency, и в Development включённый <code>ValidateScopes</code> бросит исключение при построении или резолве. Без проверки код «работал» бы с одним контекстом на всё приложение: параллельные запросы получили бы «A second operation was started on this context», а change tracker рос бы бесконечно. <code>DbContext</code> не потокобезопасен; правильно — сделать сервис scoped или использовать <code>IDbContextFactory</code>.` },

    { id: 'asp-016', chapter: 'di', type: 'choice',
      q: `Зарегистрировано:<pre><code>services.AddScoped&lt;INotifier, EmailNotifier&gt;();
services.AddScoped&lt;INotifier, PushNotifier&gt;();</code></pre>Что получит конструктор с параметром <code>INotifier</code>, а что — с параметром <code>IEnumerable&lt;INotifier&gt;</code>?`,
      options: [`Исключение о неоднозначной регистрации в обоих случаях`, `<code>EmailNotifier</code>; перечисление — только <code>EmailNotifier</code>`, `<code>PushNotifier</code>; перечисление — <code>EmailNotifier</code> и <code>PushNotifier</code>`, `<code>PushNotifier</code>; перечисление — только <code>PushNotifier</code>`],
      answer: 2,
      explain: `При резолве одного экземпляра побеждает последняя регистрация — <code>PushNotifier</code>. <code>IEnumerable&lt;T&gt;</code> возвращает все регистрации в порядке добавления. Встроенный контейнер не считает повторную регистрацию ошибкой — на этом построены переопределяемые значения по умолчанию и наборы обработчиков. Чтобы не перезаписывать уже зарегистрированное, используют <code>TryAdd*</code>.` },

    { id: 'asp-017', chapter: 'di', type: 'choice',
      q: `Сервис зарегистрирован как <code>services.AddSingleton(new KafkaProducerWrapper(config))</code>, класс реализует <code>IDisposable</code>. Кто вызовет <code>Dispose</code> при остановке приложения?`,
      options: [`Контейнер, как для любого singleton`, `Никто: контейнер не освобождает экземпляры, которые не создавал`, `Хост вызовет <code>Dispose</code> через <code>IHostApplicationLifetime</code>`, `Сборщик мусора вызовет <code>Dispose</code> при финализации`],
      answer: 1,
      explain: `Контейнер освобождает только объекты, созданные им самим — по типу реализации или фабрикой <code>sp =&gt; new ...</code>. Готовый экземпляр, переданный в <code>AddSingleton(instance)</code>, принадлежит вызывающему коду. Чтобы контейнер владел объектом, регистрируйте фабрику. Сборщик мусора <code>Dispose</code> не вызывает никогда — максимум финализатор, если он написан. Для продюсера Kafka это важно: без <code>Flush</code> и <code>Dispose</code> при остановке теряются неотправленные сообщения.` },

    { id: 'asp-018', chapter: 'di', type: 'choice',
      q: `Фоновый цикл раз в секунду делает <code>app.Services.GetRequiredService&lt;ReportBuilder&gt;()</code>, где <code>ReportBuilder</code> — transient и реализует <code>IDisposable</code>. Что будет со временем?`,
      options: [`Ничего: transient-объекты сразу собираются GC`, `Исключение: transient нельзя резолвить из корня`, `Контейнер переиспользует один экземпляр`, `Утечка памяти: корневой провайдер держит каждый экземпляр до остановки, чтобы освободить его`],
      answer: 3,
      explain: `Контейнер обязан вызвать <code>Dispose</code> у созданных им disposable-объектов, поэтому запоминает их в scope, где они созданы. Для корневого провайдера этот scope живёт до остановки приложения — объекты копятся бесконечно. Проверка scopes ловит только scoped-сервисы из корня, а transient из корня разрешён, поэтому исключения не будет. Правильно — создавать scope на итерацию и уничтожать его.` },

    { id: 'asp-019', chapter: 'di', type: 'open',
      q: `Singleton-сервису (например, обработчику сообщений Kafka) нужен <code>DbContext</code>. Как правильно это сделать и почему именно так?`,
      answer: `<p>Внедрить в singleton <code>IServiceScopeFactory</code> (он сам singleton) и на каждую единицу работы создавать scope:</p>
<pre><code>public sealed class OrderEventHandler(IServiceScopeFactory scopes)
{
    public async Task HandleAsync(OrderEvent evt, CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService&lt;AppDbContext&gt;();
        db.Orders.Add(Order.From(evt));
        await db.SaveChangesAsync(ct);
    }
}</code></pre>
<p>Scope на единицу работы, а не на жизнь сервиса: короткоживущий контекст не копит отслеживаемые сущности, не держит соединение, не отдаёт устаревшие данные и после ошибки выбрасывается вместе со своим состоянием. <code>CreateAsyncScope</code> корректно освобождает сервисы с <code>IAsyncDisposable</code>. Альтернатива для EF — <code>IDbContextFactory&lt;T&gt;</code>: регистрируется <code>AddDbContextFactory</code>, безопасно внедряется в singleton и создаёт контекст через <code>CreateDbContextAsync</code>. Если обработчику нужен ещё и контекст tenant’а, его тоже устанавливают внутри нового scope из данных сообщения.</p>` },

    { id: 'asp-020', chapter: 'di', type: 'open',
      q: `Когда ValidateScopes и ValidateOnBuild включены, а когда нет, и почему это важно?`,
      answer: `<p><code>WebApplication</code> и Generic Host включают обе проверки только в окружении Development; в остальных они выключены ради скорости старта и резолва. <code>ValidateScopes</code> запрещает резолвить scoped-сервисы из корневого провайдера и внедрять их в singleton, <code>ValidateOnBuild</code> при <code>Build()</code> проверяет, что каждую регистрацию можно создать.</p>
<p>Риск в том, что интеграционные тесты часто запускают приложение в окружении Testing или Production, и тогда captive dependency или незарегистрированная зависимость доедут до продакшена незамеченными. Поэтому в тестовом хосте я включаю их явно через <code>UseDefaultServiceProvider</code>, а иногда и в продакшене, если время старта не критично. Ещё нюанс: <code>ValidateOnBuild</code> не проверяет фабрики — что вернёт лямбда, станет известно только при вызове, — и не видит сервисы, которые резолвятся вручную из провайдера в рантайме, поэтому для фоновых сервисов полезен отдельный тест, который резолвит их зависимости из реального контейнера приложения.</p>` },

    { id: 'asp-021', chapter: 'di', type: 'open',
      q: `Есть два хранилища файлов: S3 для продакшен-данных и локальный диск для временных. Как зарегистрировать и получить нужное?`,
      answer: `<p>С .NET 8 — keyed services:</p>
<pre><code>services.AddKeyedSingleton&lt;IFileStorage, S3Storage&gt;("s3");
services.AddKeyedSingleton&lt;IFileStorage, LocalStorage&gt;("temp");

public sealed class MediaService([FromKeyedServices("s3")] IFileStorage storage) { }</code></pre>
<p>Ключи лучше держать константами или enum, чтобы не было опечаток в строках. Обычный <code>GetService&lt;IFileStorage&gt;()</code> keyed-регистрации не видит.</p>
<p>До .NET 8 или если выбор зависит от данных запроса, я бы сделал иначе: либо два разных интерфейса-маркера (<code>IMediaStorage</code>, <code>ITempStorage</code>) — самый типобезопасный вариант, — либо фабрику <code>IFileStorageFactory.Get(kind)</code>, где выбор явно виден и тестируется. Keyed хорош для статического выбора на этапе композиции; если ключ приходит из JSON запроса, атрибуты не помогут, и логика выбора должна быть в коде.</p>` },

    { id: 'asp-022', chapter: 'api', type: 'choice',
      q: `Глобальный exception filter MVC превращает исключения в ProblemDetails. Исключение из какого места он <strong>не</strong> поймает?`,
      options: [`Из метода действия`, `Из action filter`, `Из сериализации результата (выполнения <code>IActionResult</code>)`, `Из model binding`],
      answer: 2,
      explain: `Exception filters обрабатывают исключения из создания контроллера, model binding, action filters и самого действия. Исключения из resource filters, result filters и выполнения результата (например, ошибка сериализации JSON) мимо них проходят. Поэтому глобальная обработка ошибок делается middleware <code>UseExceptionHandler</code> с <code>IExceptionHandler</code>, которое стоит снаружи всего MVC и видит любые исключения.` },

    { id: 'asp-023', chapter: 'api', type: 'choice',
      q: `Контроллер помечен <code>[ApiController]</code>, в DTO на поле <code>Quantity</code> стоит <code>[Range(1, 1000)]</code>, клиент присылает <code>Quantity = 0</code>. Что произойдёт?`,
      options: [`Метод действия вызовется, <code>ModelState.IsValid</code> будет false — проверка за разработчиком`, `Ответ 400 с <code>ValidationProblemDetails</code>, метод действия не вызовется`, `Ответ 422 Unprocessable Entity`, `Ответ 500: валидация бросает <code>ValidationException</code>`],
      answer: 1,
      explain: `<code>[ApiController]</code> добавляет фильтр, который при невалидном <code>ModelState</code> после биндинга сразу возвращает 400 с <code>ValidationProblemDetails</code> (словарь ошибок по полям), не вызывая действие. Первый вариант — поведение без <code>[ApiController]</code> или с <code>SuppressModelStateInvalidFilter = true</code>. 422 фреймворк по умолчанию не использует, хотя многие команды выбирают его для бизнес-ошибок сами.` },

    { id: 'asp-024', chapter: 'api', type: 'choice',
      q: `Эндпоинт объявлен как <code>app.MapGet("/orders/{id:int}", ...)</code>. Клиент запрашивает <code>/orders/abc</code>. Какой ответ он получит (других маршрутов нет)?`,
      options: [`404 Not Found`, `400 Bad Request с ошибкой валидации <code>id</code>`, `500: не удалось преобразовать <code>abc</code> в <code>int</code>`, `200 с <code>id = 0</code>`],
      answer: 0,
      explain: `Ограничения маршрута участвуют в <strong>выборе</strong> эндпоинта, а не в валидации: <code>abc</code> не проходит <code>int</code>, маршрут не совпадает, подходящего эндпоинта нет — 404. Чтобы вернуть клиенту 400 с понятной ошибкой, ограничение убирают и проверяют параметр сами (или принимают строку). Это частый источник «почему у нас 404 вместо 400» в API.` },

    { id: 'asp-025', chapter: 'api', type: 'open',
      q: `Обработчики возвращают <code>Result&lt;T&gt;</code> с кодом ошибки вместо исключений. Как спроектировать превращение этого в HTTP-ответы?`,
      answer: `<p>Ошибка в домене — это код (enum или стабильная строка) с аргументами и категорией: не найдено, конфликт, нарушение правила, нет прав. На границе API один общий метод маппит категорию в статус — 404, 409, 400 или 422, 403 — и формирует ProblemDetails: <code>title</code> по статусу, <code>detail</code> — локализованный текст из ресурсов по коду и аргументам, extensions — <code>code</code>, <code>args</code>, <code>traceId</code>.</p>
<p>Контракт для клиента — именно <code>code</code> и <code>args</code>: текст можно менять и переводить, а фронтенд строит свои сообщения по коду. Все коды документируются, а тест проверяет, что у каждого кода есть переводы на все языки с одинаковыми плейсхолдерами.</p>
<p>Важно, чтобы маппинг был в одном месте — базовом контроллере или фильтре для minimal API — и чтобы метод, превращающий успех в ответ, нельзя было случайно вызвать «без тела»: например, отдельный явно названный метод для 204. Исключения остаются для неожиданного и ловятся <code>IExceptionHandler</code>, который отдаёт тот же формат.</p>` },

    { id: 'asp-026', chapter: 'api', type: 'open',
      q: `Что такое over-posting (mass assignment) и как от него защититься в ASP.NET Core?`,
      answer: `<p>Это когда модель запроса содержит больше полей, чем клиенту разрешено менять, и model binding честно заполняет их все. Классический пример — биндинг прямо в сущность EF: клиент добавляет в JSON <code>"isAdmin": true</code> или <code>"organizationId": "..."</code>, и после <code>SaveChanges</code> это оказывается в базе.</p>
<p>Защита — отдельные DTO запросов на каждую операцию ровно с теми полями, которые можно менять, и явный перенос в доменную модель через методы, проверяющие правила. Поля вроде tenant’а, автора, статуса никогда не берутся из тела — только из контекста запроса. <code>[Bind]</code> и <code>[BindNever]</code> существуют, но это хрупкая защита по списку, а не по конструкции.</p>
<p>Родственная проблема на чтении — over-fetching: отдавать сущность целиком, включая внутренние поля. Поэтому и ответы — отдельные DTO. Для частичного обновления я предпочитаю явные команды или PATCH с явно перечисленными полями, а не JSON Patch, который позволяет клиенту адресовать любое свойство.</p>` },

    { id: 'asp-027', chapter: 'api', type: 'open',
      q: `Как с встроенным OpenAPI в .NET 9+ добавить в каждую операцию документа информацию о требуемом праве, которое задаётся атрибутом на эндпоинте?`,
      answer: `<p>Через operation transformer. Он вызывается для каждой операции и получает контекст с описанием эндпоинта, откуда можно прочитать метаданные:</p>
<pre><code>public sealed class PermissionOperationTransformer : IOpenApiOperationTransformer
{
    public Task TransformAsync(OpenApiOperation operation, OpenApiOperationTransformerContext context, CancellationToken ct)
    {
        var permission = context.Description.ActionDescriptor.EndpointMetadata
            .OfType&lt;RequiresPermissionAttribute&gt;().FirstOrDefault();
        if (permission is not null)
        {
            // добавить расширение x-permission в операцию
        }
        return Task.CompletedTask;
    }
}

builder.Services.AddOpenApi(o =&gt; o.AddOperationTransformer&lt;PermissionOperationTransformer&gt;());</code></pre>
<p>Точный тип значения расширения зависит от версии Microsoft.OpenApi, поэтому этот кусок я сверю с документацией. Смысл в том, что клиент генерирует карту «какой кнопке какое право нужно» из документа, а не угадывает. Полезно дополнить тестом, который проходит по всем эндпоинтам и требует, чтобы у каждого организационного эндпоинта право было объявлено, — тогда документ и реальная проверка не разойдутся.</p>` },

    { id: 'asp-028', chapter: 'auth', type: 'choice',
      q: `Какое значение <code>ClockSkew</code> у <code>TokenValidationParameters</code> по умолчанию и что оно означает?`,
      options: [`0 — токен недействителен ровно в момент <code>exp</code>`, `30 секунд допуска на расхождение часов`, `5 минут: токен считается действительным ещё 5 минут после <code>exp</code>`, `1 час, чтобы клиент успел обновить токен`],
      answer: 2,
      explain: `По умолчанию допуск — 5 минут в обе стороны для <code>exp</code> и <code>nbf</code>, чтобы небольшое расхождение часов между IdP и API не ломало аутентификацию. Для access token’ов со временем жизни в 5 минут это фактически удваивает их жизнь, поэтому значение часто уменьшают до десятков секунд. Ноль ставить рискованно: при малейшем рассинхроне часов свежие токены начнут отклоняться.` },

    { id: 'asp-029', chapter: 'auth', type: 'choice',
      q: `Пользователь прислал валидный, неистёкший JWT, но политика эндпоинта требует право, которого у него нет. Какой ответ даст API с JWT bearer по умолчанию?`,
      options: [`401 Unauthorized с <code>WWW-Authenticate</code>`, `403 Forbidden`, `404 Not Found`, `400 Bad Request`],
      answer: 1,
      explain: `Пользователь аутентифицирован, но не авторизован — вызывается Forbid, и bearer-схема отвечает 403. 401 (Challenge) — для случая, когда пользователя нет: токен отсутствует, просрочен или невалиден. Различие важно для клиента: на 401 он пытается обновить токен и войти заново, на 403 — нет. 404 вы можете вернуть сами в resource-based авторизации, если не хотите раскрывать существование ресурса, но по умолчанию политика этого не делает.` },

    { id: 'asp-030', chapter: 'auth', type: 'choice',
      q: `Для одного требования зарегистрированы два обработчика. Первый вызвал <code>context.Succeed(requirement)</code>, второй — <code>context.Fail()</code>. Чем закончится авторизация?`,
      options: [`Успехом: достаточно одного <code>Succeed</code>`, `Результат зависит от порядка регистрации обработчиков`, `Исключением: обработчики противоречат друг другу`, `Отказом: <code>Fail</code> — это вето, которое перекрывает любой <code>Succeed</code>`],
      answer: 3,
      explain: `Требование удовлетворено, если хотя бы один обработчик вызвал <code>Succeed</code> и <strong>ни один</strong> не вызвал <code>Fail</code>. Поэтому <code>Fail</code> работает как вето, а обычное «не подходит» выражается тем, что обработчик ничего не вызывает. Вариант «достаточно одного Succeed» верен ровно до тех пор, пока никто не вызвал <code>Fail</code>, — отсюда и соблазн. Порядок регистрации на итог не влияет.` },

    { id: 'asp-031', chapter: 'auth', type: 'open',
      q: `Фронтенд получил токен в Keycloak, а API отвечает 401 с ошибкой про audience. Почему и как исправить правильно?`,
      answer: `<p>API ожидает в <code>aud</code> своё имя (например, <code>backend</code>), а Keycloak по умолчанию кладёт в access token аудиторию <code>account</code> — ресурса личного кабинета — и не знает, что токен предназначен для вашего API. Проверка audience падает, и это правильно.</p>
<p>Правильное исправление — на стороне Keycloak: добавить клиенту фронтенда audience mapper или client scope, который вписывает в токен аудиторию API. Тогда токен явно выпущен «для этого API». Неправильное — выключить <code>ValidateAudience</code>: тогда API примет любой токен этого realm’а, выпущенный для любого другого клиента, и компрометация одного приложения даст доступ ко всем.</p>
<p>Заодно стоит проверить issuer: если API обращается к Keycloak по внутреннему адресу, а браузер — по публичному, <code>iss</code> в токене не совпадёт с ожидаемым, и ошибка будет похожей. Помогает единое имя хоста или явный <code>ValidIssuer</code>.</p>` },

    { id: 'asp-032', chapter: 'auth', type: 'open',
      q: `В системе 30 прав (ViewOrders, ManagePrices…), и каждое проверяется на своих эндпоинтах. Как организовать авторизацию без 30 вручную зарегистрированных политик?`,
      answer: `<p>Одно параметризованное требование <code>PermissionRequirement(Permission)</code> и один обработчик, который проверяет, есть ли право у пользователя в текущем tenant’е — из кэшируемого хранилища ролей. Политики строятся на лету: свой <code>IAuthorizationPolicyProvider</code> распознаёт имена вида <code>Permission:ManageOrders</code> и возвращает политику с нужным требованием, а остальные имена передаёт стандартному провайдеру. В .NET 8 можно проще: атрибут, реализующий <code>IAuthorizationRequirementData</code>, сам отдаёт требование.</p>
<pre><code>[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class RequiresPermissionAttribute(Permission permission)
    : AuthorizeAttribute, IAuthorizationRequirementData
{
    public IEnumerable&lt;IAuthorizationRequirement&gt; GetRequirements() =&gt; [new PermissionRequirement(permission)];
}</code></pre>
<p>Права — enum в коде, так что опечатки невозможны. Имеет смысл тест, который обходит все эндпоинты и требует объявленное право или явное исключение, и вывод права в OpenAPI. Если права вычисляются из ролей с импликациями (Manage подразумевает View), это делается в одном месте при вычислении набора прав, а не в каждой проверке.</p>` },

    { id: 'asp-033', chapter: 'auth', type: 'open',
      q: `Зачем задавать FallbackPolicy и чем она отличается от DefaultPolicy?`,
      answer: `<p>DefaultPolicy применяется к эндпоинтам с <code>[Authorize]</code> без указания политики; по умолчанию она требует аутентифицированного пользователя. FallbackPolicy применяется к эндпоинтам, у которых вообще <strong>нет</strong> метаданных авторизации, и по умолчанию она пустая — то есть такие эндпоинты открыты.</p>
<p>Задав FallbackPolicy с <code>RequireAuthenticatedUser()</code>, я получаю «закрыто по умолчанию»: разработчик, забывший атрибут на новом эндпоинте, сделает его недоступным анониму, а не публичным. Ошибка в безопасную сторону заметна сразу — запрос получит 401, — а в небезопасную может годами оставаться незамеченной. Открытые эндпоинты (health checks, публичные справочники, вебхуки с собственной проверкой подписи) помечаются <code>[AllowAnonymous]</code> явно, и их список легко проверить на ревью. Нужно помнить, что fallback действует и на статические файлы, если они обслуживаются после <code>UseAuthorization</code>.</p>` },

    { id: 'asp-034', chapter: 'auth', type: 'open',
      q: `Сотрудника уволили, а его JWT действует ещё 15 минут. Как ограничить ущерб?`,
      answer: `<p>JWT самодостаточен, и API не спрашивает IdP при каждом запросе, поэтому мгновенно «отозвать» его нельзя — это осознанный компромисс ради производительности. Ущерб ограничивают несколькими слоями.</p>
<p>Короткий access token — минуты — плюс refresh token, который IdP может отозвать: отключив пользователя в Keycloak, вы не дадите ему получить новый access token. Права в многопользовательском SaaS лучше не держать в токене, а вычислять на запрос из хранилища членства с коротким кэшем и сбросом при изменении — тогда удаление из компании действует сразу, даже при живом токене. Для критичных операций (выплаты, изменение прав) можно делать token introspection к IdP или проверять в базе, что аккаунт активен.</p>
<p>Крайний вариант — denylist идентификаторов токенов (<code>jti</code>) в Redis до истечения их срока, но это возвращает состояние, от которого JWT должен был избавить, поэтому его применяют точечно.</p>` },

    { id: 'asp-035', chapter: 'background', type: 'choice',
      q: `Приложение на .NET 8 после добавления этого сервиса перестало отвечать на HTTP-запросы сразу после старта. Почему?<pre><code>public sealed class Consumer(IConsumer&lt;string, string&gt; kafka) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        kafka.Subscribe("orders");
        while (!ct.IsCancellationRequested)
        {
            var msg = kafka.Consume(ct);
            await HandleAsync(msg, ct);
        }
    }
}</code></pre>`,
      options: [`Kafka-клиент нельзя внедрять в hosted service`, `Синхронный блокирующий <code>Consume</code> выполняется в потоке запуска хоста до первого реального <code>await</code>, и запуск не продолжается`, `<code>ExecuteAsync</code> обязан вернуть управление за 5 секунд, иначе хост его отменяет`, `Не вызван <code>base.ExecuteAsync(ct)</code>`],
      answer: 1,
      explain: `<code>BackgroundService.StartAsync</code> на .NET 8 вызывает <code>ExecuteAsync</code> синхронно, пока тот не дойдёт до незавершённого <code>await</code>. Здесь до него стоит блокирующий <code>Consume</code>, который ждёт сообщения, — поток запуска хоста занят, остальные hosted services и сервер не стартуют. Лечится <code>await Task.Yield()</code> в начале или выносом цикла в отдельную задачу (для блокирующего клиента — на выделенный поток). Ограничения «5 секунд» на старт нет, а <code>ExecuteAsync</code> абстрактный, вызывать базовую реализацию нечего.` },

    { id: 'asp-036', chapter: 'background', type: 'choice',
      q: `В <code>ExecuteAsync</code> вылетело необработанное исключение. Что по умолчанию произойдёт в .NET 8?`,
      options: [`Исключение логируется и хост останавливается`, `Исключение проглатывается, сервис молча перестаёт работать, приложение живёт дальше`, `Хост автоматически перезапускает <code>ExecuteAsync</code>`, `Процесс аварийно завершается без записи в лог`],
      answer: 0,
      explain: `С .NET 6 значение по умолчанию <code>BackgroundServiceExceptionBehavior.StopHost</code>: исключение логируется как ошибка, и хост начинает остановку, после чего оркестратор перезапустит под. Вариант «проглатывается» — поведение до .NET 6 и сейчас при <code>Ignore</code>; оно опасно тем, что приложение выглядит здоровым. Автоматического перезапуска сервиса фреймворк не делает — устойчивость к ошибкам отдельных сообщений нужно реализовать внутри цикла.` },

    { id: 'asp-037', chapter: 'background', type: 'choice',
      q: `Канал создан как <code>Channel.CreateBounded&lt;Job&gt;(new BoundedChannelOptions(100) { FullMode = BoundedChannelFullMode.Wait })</code>. В нём 100 элементов, читатель отстаёт. Что сделает <code>await writer.WriteAsync(job)</code>?`,
      options: [`Бросит <code>ChannelClosedException</code>`, `Выбросит самый старый элемент и добавит новый`, `Асинхронно подождёт, пока в канале освободится место`, `Добавит элемент сверх лимита и залогирует предупреждение`],
      answer: 2,
      explain: `<code>Wait</code> — это backpressure: писатель асинхронно ждёт свободного места, не теряя данных и не занимая поток. Выброс старого элемента — режим <code>DropOldest</code>, есть ещё <code>DropNewest</code> и <code>DropWrite</code>. <code>ChannelClosedException</code> бывает только после <code>Complete()</code> у писателя. Ограниченный канал как раз и нужен, чтобы под нагрузкой память не росла бесконечно.` },

    { id: 'asp-038', chapter: 'background', type: 'open',
      q: `В liveness-пробу сервиса добавили проверку PostgreSQL. Ночью база была недоступна две минуты. Что произошло и как надо было сделать?`,
      answer: `<p>Liveness-проба провалилась у всех подов одновременно, и Kubernetes начал их перезапускать. Перезапуск базу не починил, а когда она вернулась, все поды стартовали холодными: прогрев кэшей, установка соединений, ребалансировка консьюмеров Kafka — инцидент на две минуты превратился в гораздо более долгую деградацию, возможно, с CrashLoopBackOff.</p>
<p>Правильно разделить пробы. Liveness проверяет только то, что процесс жив и не завис: отвечает ли он вообще, работают ли его внутренние циклы — например, heartbeat фонового воркера. Проверки внешних зависимостей идут в readiness: при недоступной базе под выводится из балансировки, но не перезапускается, и как только база вернётся, сразу снова принимает трафик. В ASP.NET Core это два <code>MapHealthChecks</code> с фильтром по тегам. Для медленного старта — startup probe, чтобы liveness не убил под во время миграций или прогрева.</p>` },

    { id: 'asp-039', chapter: 'background', type: 'open',
      q: `Как реализовать надёжную публикацию событий в Kafka после изменения данных в PostgreSQL (transactional outbox) на BackgroundService?`,
      answer: `<p>Обработчик команды в одной транзакции меняет данные и пишет событие в таблицу outbox. Так событие и изменение либо оба сохранены, либо оба нет — без распределённой транзакции.</p>
<p>Фоновый сервис в цикле с <code>PeriodicTimer</code> на каждой итерации создаёт scope, выбирает пачку неотправленных строк по порядку с <code>FOR UPDATE SKIP LOCKED</code>, чтобы несколько реплик не брали одно и то же, публикует их в Kafka с ключом агрегата (для порядка внутри партиции), дожидается подтверждения брокера и помечает строки отправленными. Ошибка публикации — лог и пауза, строки останутся на следующую итерацию.</p>
<p>Гарантия получается at-least-once: если процесс упадёт после публикации, но до отметки, событие уйдёт повторно, поэтому консьюмеры идемпотентны — по id события. Отправленные строки периодически чистятся. Дополнительно: <code>traceparent</code> сохраняется в строку outbox и кладётся в заголовки сообщения, чтобы трейс не обрывался, а метрика размера неотправленного хвоста идёт в алерты.</p>` },

    { id: 'asp-040', chapter: 'background', type: 'open',
      q: `Почему для периодической работы в BackgroundService лучше <code>PeriodicTimer</code>, а не <code>System.Threading.Timer</code>?`,
      answer: `<p>Колбэк <code>System.Threading.Timer</code> синхронный и вызывается на пуле по расписанию независимо от того, закончился ли предыдущий вызов: если работа дольше интервала, вызовы перекрываются и конкурируют. Чтобы вызвать асинхронный код, приходится писать <code>async void</code> внутри колбэка — тогда исключения теряются или роняют процесс, а ждать окончания работы при остановке нечем.</p>
<p><code>PeriodicTimer</code> асинхронный: <code>await timer.WaitForNextTickAsync(ct)</code> встраивается в обычный цикл, следующий тик ожидается только после завершения текущей итерации, так что перекрытий нет. Он принимает токен отмены, поэтому остановка хоста естественно завершает цикл, а исключения обрабатываются обычным <code>try/catch</code>. Тики, пропущенные во время долгой итерации, не накапливаются. Для работы, которая должна выполниться ровно один раз на кластер, таймер дополняют блокировкой в базе или идемпотентностью.</p>` },

    { id: 'asp-041', chapter: 'http', type: 'choice',
      q: `Что не так с этим кодом в сервисе с нагрузкой в тысячи запросов в секунду?<pre><code>public async Task&lt;decimal&gt; GetRateAsync(string code)
{
    using var client = new HttpClient { BaseAddress = new Uri("https://rates.internal/") };
    return await client.GetFromJsonAsync&lt;decimal&gt;($"rates/{code}");
}</code></pre>`,
      options: [`Ничего, <code>using</code> гарантирует освобождение ресурсов`, `<code>GetFromJsonAsync</code> нельзя использовать с <code>decimal</code>`, `<code>BaseAddress</code> должен заканчиваться без слэша`, `Новое соединение на каждый вызов: сокеты копятся в <code>TIME_WAIT</code>, под нагрузкой кончаются порты`],
      answer: 3,
      explain: `Dispose клиента закрывает его соединения, но закрытые сокеты остаются в <code>TIME_WAIT</code> и держат локальные порты; под нагрузкой порты заканчиваются — socket exhaustion. Плюс каждый вызов платит за TCP- и TLS-рукопожатие. «<code>using</code> освобождает ресурсы» — именно та интуиция, которая здесь подводит. Правильно — <code>IHttpClientFactory</code> с typed client или долгоживущий клиент с <code>SocketsHttpHandler.PooledConnectionLifetime</code>.` },

    { id: 'asp-042', chapter: 'http', type: 'choice',
      q: `Сколько по умолчанию живёт пулящийся <code>HttpMessageHandler</code> в <code>IHttpClientFactory</code> и зачем вообще есть это время жизни?`,
      options: [`2 минуты: handler периодически пересоздаётся, чтобы соединения обновлялись и подхватывали изменения DNS`, `100 секунд, совпадает с <code>HttpClient.Timeout</code>`, `Бесконечно, пока жив процесс: так соединения переиспользуются лучше всего`, `Один запрос: фабрика создаёт handler на каждый <code>CreateClient</code>`],
      answer: 0,
      explain: `<code>HandlerLifetime</code> по умолчанию 2 минуты. Фабрика переиспользует handler (и его пул соединений) в течение этого времени, затем выдаёт новым клиентам новый handler, а старый освобождается, когда его перестают использовать. Это компромисс между переиспользованием соединений и реакцией на смену DNS. «Бесконечно» — поведение статического клиента без <code>PooledConnectionLifetime</code>, и именно его проблему с DNS фабрика решает. 100 секунд — это <code>HttpClient.Timeout</code>, к handler’ам отношения не имеет.` },

    { id: 'asp-043', chapter: 'http', type: 'choice',
      q: `Какое утверждение о standard resilience handler (<code>AddStandardResilienceHandler</code>) верно?`,
      options: [`Он повторяет запрос при любом статусе, отличном от 2xx`, `Общий таймаут запроса — внешняя стратегия и ограничивает все попытки вместе, а таймаут попытки — внутренняя и ограничивает каждую попытку отдельно`, `Circuit breaker в нём стоит снаружи retry, поэтому разомкнутая цепь отменяет повторы`, `После его подключения <code>HttpClient.Timeout</code> перестаёт действовать`],
      answer: 1,
      explain: `Порядок стратегий от внешней к внутренней: rate limiter, total request timeout, retry, circuit breaker, attempt timeout. Поэтому общий таймаут ограничивает всю операцию с повторами, а таймаут попытки — каждую. Повторы идут только на транзиентные ошибки (5xx, 408, 429, сетевые), а не на любой не-2xx — 400 или 404 повторять бессмысленно. Breaker стоит внутри retry, не снаружи. <code>HttpClient.Timeout</code> продолжает действовать поверх и может оборвать запрос раньше, если он меньше общего таймаута.` },

    { id: 'asp-044', chapter: 'http', type: 'choice',
      q: `Клиент вызывает unary-метод gRPC без указания deadline, а сервер завис и не отвечает. Что произойдёт?`,
      options: [`Через 100 секунд сработает таймаут <code>HttpClient</code>, как у REST`, `Через 30 секунд сработает deadline по умолчанию`, `Вызов будет ждать, пока его не отменят токеном или не оборвётся соединение`, `Клиент сразу получит <code>Unavailable</code>`],
      answer: 2,
      explain: `В gRPC deadline по умолчанию не задан, и вызов ждёт бесконечно — до отмены <code>CancellationToken</code>, разрыва соединения или ответа. Поэтому deadline ставят на каждый вызов явно (в UTC) и пробрасывают оставшийся бюджет вниз по цепочке. Вариант про 100 секунд соблазнителен, потому что <code>GrpcChannel</code> построен на <code>HttpClient</code>, но ограничение времени вызова в gRPC — это именно deadline, и без него клиент ждёт ответа сколько угодно.` },

    { id: 'asp-045', chapter: 'http', type: 'open',
      q: `В <code>DelegatingHandler</code> внедрили scoped-сервис <code>ICurrentUser</code>, чтобы добавлять токен пользователя в исходящие запросы. Иногда уходит токен чужого пользователя. Почему?`,
      answer: `<p>Handler’ы создаются <code>IHttpClientFactory</code> вместе с пулящимся primary handler’ом и живут, пока жив этот handler (по умолчанию около двух минут). Создаются они в <strong>собственном</strong> DI-scope фабрики, а не в scope HTTP-запроса. Значит, <code>ICurrentUser</code> внутри handler’а — это экземпляр, созданный однажды, при первом запросе, который построил handler, и дальше переиспользуемый для чужих запросов. Отсюда «чужой» токен.</p>
<p>Правильно — брать данные текущего запроса в момент отправки через <code>IHttpContextAccessor</code> (он основан на <code>AsyncLocal</code> и даёт контекст именно текущего запроса), либо передавать токен явно в метод typed client’а, либо использовать header propagation middleware. Для межсервисных вызовов без пользователя — токен сервиса по client credentials с кэшированием до истечения. Это частный случай общего правила: всё, что живёт дольше запроса, не должно держать состояние запроса.</p>` },

    { id: 'asp-046', chapter: 'http', type: 'open',
      q: `Сервис вызывает внешний платёжный провайдер (POST создания платежа). Как сделать вызов устойчивым, не рискуя двойным списанием?`,
      answer: `<p>Главная проблема — таймаут не означает, что платёж не создан: ответ мог потеряться. Поэтому слепой retry POST недопустим. Решение — ключ идемпотентности: перед первым вызовом я генерирую идентификатор операции, сохраняю его вместе с намерением платежа в своей базе и передаю провайдеру (обычно заголовком <code>Idempotency-Key</code>). Повтор с тем же ключом провайдер не выполнит второй раз, а вернёт результат первого.</p>
<p>Дальше — стратегии: короткий таймаут попытки и общий бюджет, ограниченное число повторов с экспонентой и jitter только на транзиентные ошибки, circuit breaker, чтобы не долбить лежащего провайдера. Если провайдер ключей не поддерживает — повторы для POST отключаются (<code>DisableForUnsafeHttpMethods</code>), а неизвестный исход разрешается запросом статуса или вебхуком.</p>
<p>Сам процесс оформляю как состояние в базе (создан, отправлен, подтверждён, ошибка) с фоновой сверкой: всё, что зависло в «отправлен», проверяется у провайдера. Тогда сбой посередине не оставляет неопределённости.</p>` },

    { id: 'asp-047', chapter: 'http', type: 'open',
      q: `Какие виды вызовов есть в gRPC и для чего каждый подходит в складской системе?`,
      answer: `<p><strong>Unary</strong> — один запрос, один ответ: получить остаток по SKU, зарезервировать товар. Основная масса межсервисных вызовов.</p>
<p><strong>Server streaming</strong> — один запрос, поток ответов: подписка на изменения резервов по складу, выгрузка большого отчёта частями без буферизации всего в памяти.</p>
<p><strong>Client streaming</strong> — поток запросов, один ответ: терминал сканирует сотни штрихкодов при инвентаризации и отправляет их потоком, а в конце получает сводку расхождений.</p>
<p><strong>Bidirectional streaming</strong> — оба направления независимо: интерактивная сессия сборки заказа, где сервер подсказывает следующую ячейку, а клиент подтверждает сканы.</p>
<p>Для стримов важно: пробрасывать <code>context.CancellationToken</code>, ставить deadline или иначе ограничивать время жизни потока, помнить, что долгоживущий стрим привязан к одному серверу и плохо переживает деплой — клиент должен уметь переподключаться и продолжать с последней позиции. Для широковещательных событий между сервисами часто уместнее Kafka, чем gRPC-стрим.</p>` },

    { id: 'asp-048', chapter: 'perf', type: 'choice',
      q: `Что произойдёт, если в этом действии <code>SaveChangesAsync</code> выбросит исключение?<pre><code>[HttpPost("{id}/confirm")]
public async void Confirm(Guid id)
{
    var order = await _db.Orders.FindAsync(id);
    order!.Confirm();
    await _db.SaveChangesAsync();
}</code></pre>`,
      options: [`Глобальный обработчик вернёт клиенту 500 в формате ProblemDetails`, `Исключение будет проглочено, клиент уже получил 200`, `Клиент получит 400, так как действие не вернуло результат`, `Необработанное исключение в <code>async void</code> завершит процесс; клиент к этому моменту уже мог получить пустой ответ`],
      answer: 3,
      explain: `У <code>async void</code> нет задачи, которую фреймворк мог бы дождаться: на первом <code>await</code> метод возвращает управление, MVC считает действие выполненным и завершает ответ. Исключение, выброшенное позже, не связано ни с каким <code>Task</code>, выбрасывается в пул потоков как необработанное и роняет процесс. Глобальный обработчик его не увидит — запрос для него уже закончился. Вдобавок scope запроса к этому моменту может быть уничтожен, и <code>_db</code> окажется disposed. Правильно — <code>async Task&lt;IActionResult&gt;</code>.` },

    { id: 'asp-049', chapter: 'perf', type: 'choice',
      q: `Подключили <code>AddRateLimiter</code> с fixed window лимитом и ничего больше не настраивали. Какой статус получит клиент, превысивший лимит?`,
      options: [`429 Too Many Requests`, `503 Service Unavailable`, `403 Forbidden`, `400 Bad Request`],
      answer: 1,
      explain: `<code>RateLimiterOptions.RejectionStatusCode</code> по умолчанию — 503, хотя семантически правильный ответ на превышение лимита — 429. Поэтому первое, что делают при настройке, — меняют его на 429 и в <code>OnRejected</code> выставляют <code>Retry-After</code>. 503 вводит в заблуждение и клиентов, и мониторинг: выглядит как падение сервиса, а ретрай-политики соседей начинают повторять, усиливая нагрузку.` },

    { id: 'asp-050', chapter: 'perf', type: 'choice',
      q: `Эндпоинт <code>GET /v1/catalog</code> помечен <code>.CacheOutput()</code> с базовой политикой, но кэш не срабатывает. Запросы приходят с заголовком <code>Authorization: Bearer ...</code>. В чём вероятная причина?`,
      options: [`Стандартная политика output caching не кэширует запросы аутентифицированных пользователей`, `Output caching работает только с контроллерами, не с minimal APIs`, `Клиент шлёт <code>Cache-Control: no-cache</code>, и кэш его соблюдает`, `Не подключён Redis: в памяти output cache не хранит`],
      answer: 0,
      explain: `Политика по умолчанию кэширует только GET/HEAD с ответом 200 и намеренно пропускает запросы аутентифицированных пользователей и ответы с <code>Set-Cookie</code>, чтобы не отдать одному пользователю данные другого. Если ответ действительно одинаков для всех, это включают своей политикой; если он зависит от tenant’а, ключ нужно варьировать по нему. Вариант про <code>no-cache</code> описывает response caching, который следует заголовкам клиента, — output caching ими не управляется. Хранилище в памяти используется по умолчанию.` },

    { id: 'asp-051', chapter: 'perf', type: 'open',
      q: `Под нагрузкой латентность API выросла с 50 мс до 20 секунд, CPU при этом 15%. В коде нашли <code>_client.GetStatusAsync(id).Result</code> в обработчике. Объясни, что происходит.`,
      answer: `<p>Это thread pool starvation. <code>.Result</code> блокирует поток пула, пока внешний вызов не завершится. Под нагрузкой все потоки пула оказываются заблокированы в ожидании. Но продолжения этих же асинхронных вызовов — разбор ответа, завершение задачи — тоже должны выполниться на потоке пула, а свободных нет. Пул добавляет потоки постепенно, а не мгновенно, и новые тут же блокируются следующими запросами. Работы мало, поэтому CPU низкий, а очередь пула растёт — отсюда латентность в секундах.</p>
<p>Подтверждаю через <code>dotnet-counters</code> — растут <code>ThreadPool Queue Length</code> и число потоков — и снимок стеков (<code>dotnet-stack</code> или дамп), где видно множество потоков в <code>Task.Wait</code>. Лечение — сделать цепочку асинхронной до конца: <code>await</code> вместо <code>.Result</code>, асинхронные методы вплоть до действия контроллера. <code>SetMinThreads</code> может временно снять симптом, но не причину. Классического дедлока здесь нет, потому что в ASP.NET Core нет <code>SynchronizationContext</code>, — но это не делает <code>.Result</code> безопасным.</p>` },

    { id: 'asp-052', chapter: 'perf', type: 'open',
      q: `Разработчик добавил к метрике времени обработки заказа тег <code>order_id</code>. Почему это плохая идея и куда этот идентификатор деть?`,
      answer: `<p>Каждое уникальное сочетание значений тегов — это отдельный временной ряд в системе метрик. Тег с идентификатором заказа даёт новый ряд на каждый заказ: миллионы рядов, взрыв памяти и стоимости хранения в Prometheus или облачном APM, медленные запросы, а иногда и падение сборщика. Это проблема высокой кардинальности.</p>
<p>Метрики — это агрегаты: в теги идут только измерения с ограниченным набором значений — склад, тип операции, код результата, метод, маршрут как шаблон (<code>/orders/{id}</code>), а не реальный путь. Идентификатор конкретного заказа — в трейсы (тег span’а) и в логи (поле structured logging): там высокая кардинальность нормальна, и по нему как раз ищут конкретный случай. Связка работает так: метрика показывает, что p99 вырос на складе X, exemplar или трейс показывают конкретные медленные запросы, а их логи — что именно произошло с заказом.</p>` },

    { id: 'asp-053', chapter: 'perf', type: 'open',
      q: `Трейс запроса обрывается на публикации в Kafka: в Jaeger видно HTTP-запрос и запись в топик, а обработка в консьюмере — отдельный несвязанный трейс. Как это исправить?`,
      answer: `<p>HTTP-клиент и ASP.NET Core пробрасывают W3C <code>traceparent</code> автоматически, а у стандартного клиента Kafka встроенного проброса нет, поэтому контекст на брокере теряется. Нужно сделать это вручную или через библиотеку инструментирования.</p>
<p>При публикации: создать span «publish» через свой <code>ActivitySource</code>, взять контекст текущей <code>Activity</code> и записать его в заголовки сообщения с помощью propagator’а OpenTelemetry (<code>Propagators.DefaultTextMapPropagator.Inject</code>) — заголовки <code>traceparent</code> и <code>tracestate</code>. Если публикация идёт через outbox, контекст сохраняется в строку outbox при записи и кладётся в заголовки при отправке.</p>
<p>В консьюмере: извлечь контекст из заголовков (<code>Extract</code>) и начать span обработки с этим контекстом как родителем — или как link, если сообщения обрабатываются батчами и у одного span’а много «родителей». Источник консьюмера добавляется в <code>AddSource</code>. Тогда в трейсе видна вся цепочка: HTTP, запись в топик, задержка в очереди и обработка в другом сервисе.</p>` }
  ]
});
