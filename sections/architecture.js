window.PREP = window.PREP || [];
window.PREP.push({
  id: 'architecture',
  title: 'Архитектура и паттерны',
  chapters: [
    {
      id: 'solid',
      title: 'ООП и SOLID',
      html: `
<h3>Зачем вообще SOLID и как о нём спрашивают</h3>
<p>SOLID — пять принципов объектно-ориентированного дизайна, которые Роберт Мартин (Uncle Bob) собрал в начале 2000-х, а аббревиатуру придумал Майкл Фезерс. Важно понимать, что это не законы и не чек-лист «соблюдай всегда», а эвристики управления зависимостями: каждый принцип отвечает на вопрос «как сделать так, чтобы изменение в одном месте не расползалось по всей системе».</p>
<p>На собеседовании на senior никто не хочет слышать расшифровку аббревиатуры — её знает любой джун. Проверяют три вещи:</p>
<ul>
<li><strong>Понимаете ли вы цель принципа</strong>, а не формулировку. SRP — не «класс делает одну вещь», а «у модуля одна причина для изменения».</li>
<li><strong>Видите ли нарушение в коде.</strong> Типичный формат: показывают сниппет и спрашивают «что здесь не так». Чаще всего это LSP (наследник, бросающий <code>NotSupportedException</code>) и ISP (толстый интерфейс).</li>
<li><strong>Знаете ли цену.</strong> Слепое следование SOLID даёт «интерфейс на каждый класс», десять уровней абстракции и фабрики фабрик. Senior умеет сказать, когда принцип не стоит применять.</li>
</ul>
<blockquote><strong>Важно.</strong> Хорошая мысль для собеседования: все пять принципов — про одно и то же, про связанность (coupling) и связность (cohesion). SRP и ISP повышают cohesion, OCP, LSP и DIP снижают coupling и делают его направленным.</blockquote>

<h3>S — Single Responsibility Principle</h3>
<p>Классическая формулировка Мартина: <em>у модуля должна быть одна и только одна причина для изменения</em>. В книге «Clean Architecture» он уточнил её: модуль должен отвечать перед одним и только одним <strong>актором</strong> — группой людей, которые хотят изменений. «Причина изменения» — это не «метод», а заинтересованная сторона: бухгалтерия, склад, служба безопасности.</p>
<p>Плохой пример — класс, который обслуживает трёх разных «заказчиков»:</p>
<pre><code>public class OrderService
{
    public decimal CalculateTotal(Order order) { /* правила бухгалтерии */ }
    public string RenderInvoiceHtml(Order order) { /* вёрстка счёта, хочет маркетинг */ }
    public void Save(Order order) { /* SQL, хочет DBA */ }
}</code></pre>
<p>Изменение формата счёта рискует сломать расчёт суммы, если они делят приватный хелпер; тесты расчёта тянут за собой базу. Лучше разнести по акторам:</p>
<pre><code>public class OrderPricing        { public Money Total(Order order) { ... } }
public class InvoiceRenderer     { public string Render(Order order, Money total) { ... } }
public class OrderRepository     { public Task SaveAsync(Order order, CancellationToken ct) { ... } }</code></pre>
<p>Частая ошибка — понимать SRP как «у класса один метод». Это приводит к россыпи крошечных классов, которые всё равно меняются вместе, — то есть к <strong>низкой cohesion</strong>, обратному тому, чего хотели. Правильный вопрос: «если завтра придёт требование от X, сколько классов я трону и не задену ли то, что нужно Y».</p>
<p>В .NET хорошая иллюстрация — разделение MediatR-хендлеров: один хендлер на один use case. Изменение сценария «отменить заказ» не трогает «подтвердить заказ», хотя оба работают с одним агрегатом.</p>

<h3>O — Open/Closed Principle</h3>
<p>Формулировку «программные сущности должны быть открыты для расширения и закрыты для модификации» придумал Бертран Мейер (1988), и у него расширение шло через наследование. Мартин переосмыслил принцип через полиморфизм и абстракции: новое поведение добавляется новым кодом, а не правкой работающего.</p>
<p>Плохо — каждый новый способ доставки требует правки метода:</p>
<pre><code>public decimal DeliveryCost(Order order) =&gt; order.DeliveryType switch
{
    DeliveryType.Courier =&gt; 300m,
    DeliveryType.Pickup =&gt; 0m,
    DeliveryType.Post =&gt; order.Weight * 50m,
    _ =&gt; throw new ArgumentOutOfRangeException()
};</code></pre>
<p>Лучше — точка расширения:</p>
<pre><code>public interface IDeliveryPricing
{
    DeliveryType Type { get; }
    decimal Cost(Order order);
}

public class DeliveryCalculator(IEnumerable&lt;IDeliveryPricing&gt; pricings)
{
    private readonly Dictionary&lt;DeliveryType, IDeliveryPricing&gt; _byType =
        pricings.ToDictionary(p =&gt; p.Type);

    public decimal Cost(Order order) =&gt; _byType[order.DeliveryType].Cost(order);
}</code></pre>
<p>Новый способ доставки — новый класс и одна регистрация в DI. Но обратите внимание на честную оговорку: <strong>OCP имеет смысл только вдоль оси изменений, которую вы угадали</strong>. Если способов доставки три и они не меняются годами, <code>switch</code> проще и читается лучше. А если меняется не «какие бывают доставки», а «какие у доставки бывают параметры», абстракция окажется не там. Поэтому многие предлагают правило «первый раз пиши просто, второй раз поморщись, третий раз выноси абстракцию».</p>
<p>Ещё одна тонкость: современный C# с pattern matching (иерархии record-ов и <code>switch</code> по типам) — это осознанный выбор «открыто для новых операций, закрыто для новых типов». Закрытых иерархий в C# пока нет, поэтому полноту такого <code>switch</code> компилятор не проверяет — забытый новый тип найдёт только тест или ветка <code>_ =&gt; throw</code>. Это известная дилемма expression problem: ООП-полиморфизм делает лёгким добавление типов, а switch по типам — добавление операций.</p>

<h3>L — Liskov Substitution Principle</h3>
<p>Барбара Лисков сформулировала идею в 1987 году, а в 1994 вместе с Жаннет Винг дала строгое определение поведенческого подтипа. Простыми словами: <strong>код, работающий с базовым типом, должен корректно работать с любым подтипом, не зная о нём</strong>. Это не про синтаксис (компилятор и так проверит сигнатуры), а про поведение — контракт.</p>
<p>Формальные правила, которые полезно назвать на собеседовании:</p>
<ul>
<li>Подтип не может <strong>усиливать предусловия</strong> (требовать от вызывающего больше).</li>
<li>Подтип не может <strong>ослаблять постусловия</strong> (обещать меньше).</li>
<li>Подтип должен сохранять <strong>инварианты</strong> базового типа.</li>
<li><strong>History constraint</strong>: подтип не должен позволять изменения состояния, которые базовый тип запрещает (например, мутабельный наследник неизменяемого типа).</li>
<li>Подтип не бросает новых типов исключений, которых клиент базового типа не ожидает.</li>
</ul>
<p>Классика — квадрат и прямоугольник:</p>
<pre><code>public class Rectangle
{
    public virtual int Width { get; set; }
    public virtual int Height { get; set; }
}

public class Square : Rectangle
{
    public override int Width  { set { base.Width = value; base.Height = value; } }
    public override int Height { set { base.Width = value; base.Height = value; } }
}

void Stretch(Rectangle r) { r.Width = 10; r.Height = 5; Debug.Assert(r.Width * r.Height == 50); } // падает для Square</code></pre>
<p>Математически квадрат — прямоугольник, но <em>изменяемый</em> квадрат не ведёт себя как изменяемый прямоугольник. Лечится либо неизменяемостью, либо отказом от наследования.</p>
<p>Примеры нарушений прямо в .NET, которые любят спрашивать:</p>
<ul>
<li><code>ReadOnlyCollection&lt;T&gt;</code> реализует <code>ICollection&lt;T&gt;</code> и бросает <code>NotSupportedException</code> на <code>Add</code>. Клиент <code>ICollection&lt;T&gt;</code> не может просто так подставить её. Это одновременно и нарушение ISP: интерфейс слишком широкий, поэтому позже появились <code>IReadOnlyCollection&lt;T&gt;</code> и <code>IReadOnlyList&lt;T&gt;</code>.</li>
<li>Ковариантность массивов: <code>object[] arr = new string[1]; arr[0] = 1;</code> компилируется и падает в рантайме с <code>ArrayTypeMismatchException</code>.</li>
<li><code>Stream</code> с флагами <code>CanSeek</code>, <code>CanWrite</code>: это компромисс — LSP формально соблюдён, потому что контракт явно говорит «проверь флаг», но клиенту приходится ветвиться.</li>
</ul>
<p>Признак нарушения LSP в коде — проверки типа <code>if (x is Square)</code> в клиенте или наследник с пустым/бросающим методом.</p>

<h3>I — Interface Segregation Principle</h3>
<p><em>Клиенты не должны зависеть от методов, которыми они не пользуются.</em> Толстый интерфейс связывает клиентов между собой: изменение метода, нужного одному, требует перекомпиляции, правки моков в тестах и ревью у всех остальных.</p>
<pre><code>// Плохо: репозиторий-«комбайн»
public interface IOrderRepository
{
    Task&lt;Order?&gt; GetAsync(Guid id);
    Task&lt;IReadOnlyList&lt;Order&gt;&gt; SearchAsync(OrderFilter filter);
    Task AddAsync(Order order);
    Task DeleteAsync(Guid id);
    Task&lt;byte[]&gt; ExportToExcelAsync(OrderFilter filter);
    Task RebuildSearchIndexAsync();
}</code></pre>
<p>Отчётному сервису нужен только <code>SearchAsync</code>, а в тестах он мокает шесть методов. Лучше разделить по ролям клиентов:</p>
<pre><code>public interface IOrderReader  { Task&lt;IReadOnlyList&lt;Order&gt;&gt; SearchAsync(OrderFilter filter); }
public interface IOrderStore   { Task&lt;Order?&gt; GetAsync(Guid id); Task AddAsync(Order order); }
public interface IOrderExport  { Task&lt;byte[]&gt; ExportToExcelAsync(OrderFilter filter); }</code></pre>
<p>Один класс может реализовать все три — ISP про то, от чего <strong>зависят клиенты</strong>, а не про количество классов. Интерфейс принадлежит клиенту и описывает его потребность («role interface» в терминологии Фаулера), а не всё, что умеет реализация («header interface»).</p>
<p>Обратная крайность — интерфейс на каждый метод — тоже вред: регистрация в DI раздувается, навигация по коду ломается. Критерий — реальные разные группы клиентов, а не теоретическая возможность.</p>

<h3>D — Dependency Inversion Principle и чем он не является</h3>
<p>Две части принципа: (1) модули верхнего уровня не должны зависеть от модулей нижнего уровня, оба должны зависеть от абстракций; (2) абстракции не должны зависеть от деталей, детали должны зависеть от абстракций.</p>
<p>Ключевое слово — <strong>инверсия</strong>. Без DIP зависимость в исходном коде совпадает с направлением вызова: бизнес-логика вызывает SQL и импортирует SQL-библиотеку. С DIP бизнес-логика объявляет интерфейс в <em>своём</em> модуле, а инфраструктура его реализует — стрелка зависимости в исходниках разворачивается против потока управления.</p>
<pre><code>// Domain/Application — владеет абстракцией
public interface IStockReservations
{
    Task&lt;bool&gt; TryReserveAsync(Sku sku, int quantity, CancellationToken ct);
}

// Infrastructure — зависит от Application, а не наоборот
public sealed class PostgresStockReservations(NpgsqlDataSource db) : IStockReservations { ... }</code></pre>
<p>На собеседовании почти всегда пытаются поймать на путанице трёх понятий:</p>
<table>
<thead><tr><th>Понятие</th><th>Что это</th></tr></thead>
<tbody>
<tr><td>DIP</td><td>Принцип дизайна: <em>направление</em> зависимостей и владение абстракцией.</td></tr>
<tr><td>Dependency Injection</td><td>Техника: зависимость передаётся снаружи (через конструктор), а не создаётся внутри.</td></tr>
<tr><td>IoC-контейнер</td><td>Инструмент, автоматизирующий DI (<code>Microsoft.Extensions.DependencyInjection</code>, Autofac).</td></tr>
</tbody>
</table>
<p>Можно делать DI без контейнера (Pure DI, ручная сборка в Composition Root). Можно использовать контейнер и нарушать DIP: если интерфейс <code>IOrderRepository</code> лежит в проекте Infrastructure, а Application ссылается на Infrastructure, то зависимость не инвертирована — интерфейс лишь декорация. И можно соблюдать DIP вообще без интерфейсов — через делегат <code>Func&lt;...&gt;</code>, объявленный потребителем.</p>
<p>Отдельная анти-практика — Service Locator: класс получает <code>IServiceProvider</code> и сам достаёт зависимости. Зависимости спрятаны, класс нельзя понять по конструктору, ошибки конфигурации проявляются в рантайме.</p>

<h3>DRY, KISS, YAGNI</h3>
<p><strong>DRY</strong> (Хант и Томас, «The Pragmatic Programmer»): каждое <em>знание</em> должно иметь единственное, однозначное, авторитетное представление в системе. Ключевое слово — знание, а не текст. Два одинаковых куска кода, которые меняются по разным причинам (валидация ИНН в регистрации и в импорте контрагентов могут разойтись), — это случайное совпадение, и их объединение создаёт ложную связанность. Наоборот, одно правило, записанное в двух местах разными словами (лимит в C# и тот же лимит в SQL-констрейнте), — нарушение DRY, хотя текст разный. Хороший афоризм для собеседования: «дублирование дешевле неправильной абстракции» — его обычно связывают с Сэнди Метц.</p>
<p><strong>KISS</strong> — делайте самое простое решение, которое решает задачу. Простое ≠ лёгкое: простое — это мало сущностей и мало связей, а не «быстро накидать».</p>
<p><strong>YAGNI</strong> (из Extreme Programming): не реализуйте то, что «понадобится потом». Каждая спекулятивная абстракция стоит денег сейчас (код, тесты, когнитивная нагрузка) и, скорее всего, окажется не той, когда требование действительно придёт. YAGNI не запрещает думать о будущем — он запрещает <em>платить</em> за будущее заранее. Решения, которые трудно отменить (схема БД, публичный контракт API), заслуживают продумывания; внутренний класс — нет.</p>
<p>Эти три принципа — противовес SOLID. Если на собеседовании спрашивают «как вы понимаете, что переусложнили», хороший ответ: абстракция с одной реализацией без реальной причины (тест, граница модуля), слои, которые только пробрасывают вызовы, и изменения, требующие правки в пяти файлах ради одного поля.</p>

<h3>Композиция вместо наследования, coupling и cohesion</h3>
<p>Совет «предпочитайте композицию объектов наследованию классов» сформулирован ещё в книге «банды четырёх» (GoF, 1994). Наследование — самая сильная связь в ООП: наследник видит protected-детали, зависит от порядка вызовов виртуальных методов в базе (проблема хрупкого базового класса) и не может сменить родителя в рантайме.</p>
<pre><code>// Наследование: комбинаторный взрыв
class CachedLoggingSqlRepository : LoggingSqlRepository { ... }

// Композиция: поведение собирается из частей
IRepository repo = new CachingRepository(
                       new LoggingRepository(
                           new SqlRepository(db), logger), cache);</code></pre>
<p>Наследование уместно, когда есть настоящее отношение «является» с общим инвариантом и стабильной базой (например, <code>Exception</code>, <code>BackgroundService</code>, <code>ControllerBase</code>). В доменных моделях глубокие иерархии почти всегда хуже, чем композиция и интерфейсы. Хорошая практика в C# — делать классы <code>sealed</code> по умолчанию.</p>
<p><strong>Coupling (связанность)</strong> — насколько модули зависят друг от друга. Виды от худшего к лучшему: зависимость от содержимого (лезем в чужие приватные данные или чужую таблицу), общая глобальная переменная, управляющая связь (передаём флаг, меняющий поведение), связь по структуре (передаём объект целиком, используя одно поле), связь по данным (передаём ровно нужное). Также различают <em>afferent</em> (кто зависит от меня) и <em>efferent</em> (от кого завишу я).</p>
<p><strong>Cohesion (связность внутри модуля)</strong> — насколько элементы модуля относятся к одной задаче. Цель — <strong>высокая связность и слабая связанность</strong> (low coupling, high cohesion). Русские переводы расходятся: в русской Википедии и переводах GRASP coupling — «зацепление», cohesion — «связность», в разговоре coupling чаще называют «связанностью»; на собеседовании надёжнее произносить английские термины. всё, что меняется вместе, лежит вместе, а между модулями — узкие явные интерфейсы. Именно эту пару терминов ввели Ларри Константин и Эдвард Йордон в структурном проектировании 1970-х, задолго до SOLID.</p>
<p>Ещё один полезный принцип — <strong>Law of Demeter</strong> («говори только с ближайшими друзьями»): цепочка <code>order.Customer.Address.City.Name</code> связывает вызывающий код со всей структурой графа. Лучше <code>order.DeliveryCity()</code> или передача нужного значения.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Объясните SRP. Как понять, что у класса больше одной ответственности?»</summary>
<p>SRP — это не «класс делает одну вещь», а «у модуля одна причина для изменения», или, как уточнил Мартин, модуль отвечает перед одним актором. Я проверяю это вопросом: от каких людей или подсистем могут прийти требования, которые заставят этот класс меняться. Если от бухгалтерии и от команды, отвечающей за хранение, — ответственностей две. Практические признаки: класс тянет зависимости из разных миров (HTTP-клиент, SQL и шаблонизатор сразу), у него методы, которые не используют общие поля, тесты одной части требуют настраивать другую, а в git-истории класс меняется в несвязанных задачах. Обратная ошибка — дробить до одного метода на класс: это убивает cohesion, потому что то, что меняется вместе, разъезжается по файлам. В моей практике MediatR-хендлер на один use case — хороший естественный уровень гранулярности.</p>
</details>
<details><summary>«Приведите пример нарушения LSP из реального кода или из .NET»</summary>
<p>Самый известный пример в самом .NET — <code>ReadOnlyCollection&lt;T&gt;</code>, реализующий <code>ICollection&lt;T&gt;</code>: метод <code>Add</code> бросает <code>NotSupportedException</code>, то есть подтип ослабляет постусловие базового контракта, и код, принимающий <code>ICollection&lt;T&gt;</code>, сломается. Второй — ковариантность массивов: присвоение в <code>object[]</code>, который на самом деле <code>string[]</code>, падает в рантайме. Из прикладного кода типичное нарушение — наследник, который переопределяет метод пустым или бросающим, например <code>ReadOnlyRepository : Repository</code> с бросающим <code>Save</code>, или наследник, который требует дополнительной инициализации перед вызовом (усиление предусловия). Симптом на стороне клиента — проверки <code>is</code> конкретного подтипа. Лечение — пересмотреть иерархию: выделить узкие интерфейсы (что и сделали в .NET, добавив <code>IReadOnlyCollection&lt;T&gt;</code>), сделать типы неизменяемыми или заменить наследование композицией.</p>
</details>
<details><summary>«Чем DIP отличается от Dependency Injection и IoC-контейнера?»</summary>
<p>DIP — принцип про направление зависимостей и владение абстракцией: высокоуровневая политика объявляет интерфейс, а низкоуровневая деталь его реализует, поэтому зависимость в исходниках идёт от инфраструктуры к домену, против потока вызовов. DI — техника передачи зависимостей снаружи, обычно через конструктор. Контейнер — инструмент, который автоматизирует сборку графа объектов. Это ортогональные вещи: можно внедрять зависимости вручную в Composition Root без всякого контейнера, и можно пользоваться контейнером, нарушая DIP, — если интерфейс репозитория лежит в инфраструктурной сборке и домен на неё ссылается, инверсии нет. Проверка простая: посмотреть на граф ссылок между проектами и спросить, кто владеет интерфейсом. Ещё добавлю, что Service Locator формально использует контейнер, но скрывает зависимости и считается анти-паттерном.</p>
</details>
<details><summary>«Не противоречит ли OCP принципу YAGNI?»</summary>
<p>Противоречие кажущееся, если понимать OCP как «заранее вставляй точки расширения везде». Так делать не нужно: абстракция, сделанная под гипотетическое требование, обычно оказывается не на той оси изменений, и её приходится ломать. Я применяю OCP реактивно: когда вижу, что одна и та же часть кода меняется уже второй-третий раз по однотипной причине — новый способ оплаты, новый формат выгрузки, — выношу вариативность в стратегию. До этого switch на три ветки проще и честнее. YAGNI запрещает платить за будущее заранее, OCP говорит, как сделать так, чтобы будущие изменения стоили дёшево там, где мы уже знаем, что они будут. Исключение — публичные контракты и библиотеки: у SDK, которым пользуются другие команды, точки расширения продумываются заранее, потому что ломать контракт дорого.</p>
</details>
<details><summary>«Что такое DRY на самом деле? Бывает ли дублирование полезным?»</summary>
<p>В оригинале у Ханта и Томаса DRY — про знание: у каждого факта о системе должно быть одно авторитетное представление. Поэтому два похожих фрагмента кода, которые меняются по разным причинам, — это не нарушение DRY, а совпадение, и объединять их опасно: общий хелпер с флагами для двух клиентов создаёт связанность, и при изменении одного сценария ломается второй. И наоборот: одно бизнес-правило, записанное и в коде, и в SQL-процедуре, и во фронтенде, — нарушение DRY, даже если текст разный. Полезное дублирование — между bounded contexts и микросервисами: у склада и у биллинга может быть своё понятие «товар», и общая библиотека моделей между сервисами связывает их релизы. Правило, которым я пользуюсь: дублирование дешевле неправильной абстракции, абстракцию выношу, когда понимаю общий смысл, а не общий текст.</p>
</details>
<details><summary>«Почему композиция предпочтительнее наследования? Когда наследование всё же уместно?»</summary>
<p>Наследование — самая сильная форма связи: наследник зависит от внутренней реализации базы, от порядка вызова виртуальных методов, и изменение базового класса может сломать наследников, которых автор базы даже не видел, — это проблема хрупкого базового класса. Оно статично: нельзя в рантайме сменить поведение. И оно плохо комбинируется: кэширование, логирование и ретраи через наследование дают комбинаторный взрыв классов, а через декораторы собираются как конструктор. Наследование уместно, когда есть реальное отношение «является» со стабильным общим контрактом и база спроектирована для расширения — Template Method в <code>BackgroundService</code>, иерархия исключений, абстрактный базовый класс агрегата с общими доменными событиями. По умолчанию я делаю классы <code>sealed</code>, а наследование открываю осознанно.</p>
</details>
<details><summary>«Что такое coupling и cohesion, и как их измерить в живом проекте?»</summary>
<p>Coupling — степень зависимости модулей друг от друга, cohesion — степень того, насколько содержимое модуля относится к одной задаче; цель — слабая связанность и высокая связность. Измерять можно формально: метрики afferent/efferent coupling и нестабильности по Мартину, LCOM для классов, инструменты вроде NDepend или ArchUnitNET-тестов на запрещённые зависимости. Но на практике самый честный индикатор — история изменений: если типичная фича требует правок в пяти проектах и трёх сервисах, связанность высокая; если файлы, которые всегда меняются вместе, лежат в разных местах, связность (cohesion) низкая. В микросервисах высокая связанность выглядит как необходимость синхронного релиза нескольких сервисов. Я бы рассказал, как это проявлялось на реальном проекте и что сделали — например, перенесли логику ближе к данным или объединили сервисы.</p>
</details>
<details><summary>«Нарушает ли интерфейс с одной реализацией какие-то принципы? Нужно ли делать интерфейс на каждый сервис?»</summary>
<p>Сам по себе не нарушает, но и не всегда оправдан. Интерфейс нужен, когда есть причина: граница слоя по DIP (домен объявляет порт, инфраструктура реализует), реальная вариативность, необходимость подменить внешнюю систему в тестах, декорирование. Интерфейс на каждый внутренний класс «на всякий случай» — это header interface, который дублирует сигнатуры реализации, удваивает навигацию и не даёт ни изоляции, ни гибкости. Для моков внутренних сервисов часто лучше тестировать через публичный вход use case с реальными внутренними классами, а подменять только внешние зависимости — базу, брокер, HTTP. Так тесты меньше ломаются при рефакторинге. Короче: интерфейс — это контракт для клиента, а не ритуал.</p>
</details>
`
    },
    {
      id: 'patterns',
      title: 'Паттерны GoF, которые реально спрашивают',
      html: `
<h3>Как говорить о паттернах на собеседовании</h3>
<p>Книга «Design Patterns: Elements of Reusable Object-Oriented Software» (Гамма, Хелм, Джонсон, Влиссидес, 1994 — «банда четырёх», GoF) описывает 23 паттерна в трёх группах: порождающие (creational), структурные (structural) и поведенческие (behavioral). На собеседовании на senior .NET почти никогда не просят перечислить все 23. Спрашивают три типа вещей:</p>
<ul>
<li>«Какой паттерн здесь?» — показывают код и ждут не только название, но и <strong>намерение</strong> (intent): Decorator и Proxy структурно одинаковы, различаются целью.</li>
<li>«Где этот паттерн в .NET?» — проверка, что вы видели паттерны в живом фреймворке, а не только в учебнике.</li>
<li>«Когда он вреден?» — Singleton, Service Locator, фабрики фабрик.</li>
</ul>
<p>Паттерн — это словарь: имя для типового решения типовой проблемы с известными последствиями. Хорошо звучит фраза «здесь естественно ложится декоратор, потому что...», плохо — «я применил паттерн Стратегия» без объяснения проблемы. Многие классические паттерны в C# схлопываются в языковые конструкции: Strategy — в делегат, Observer — в <code>event</code>, Iterator — в <code>IEnumerable&lt;T&gt;</code> и <code>yield return</code>, Command — в лямбду или record-запрос MediatR.</p>

<h3>Strategy</h3>
<p><strong>Намерение:</strong> определить семейство алгоритмов, инкапсулировать каждый и сделать их взаимозаменяемыми; алгоритм меняется независимо от клиента.</p>
<pre><code>public interface IRoutingStrategy
{
    IReadOnlyList&lt;Cell&gt; BuildPickRoute(IReadOnlyList&lt;Cell&gt; cells);
}

public sealed class SnakeRouting : IRoutingStrategy { ... }   // змейкой по рядам
public sealed class ZoneRouting  : IRoutingStrategy { ... }   // сначала зона, потом ряды

public sealed class PickListBuilder(IRoutingStrategy routing)
{
    public PickList Build(Order order) =&gt; new(routing.BuildPickRoute(order.Cells()));
}</code></pre>
<p>В .NET: <code>IComparer&lt;T&gt;</code> и <code>IEqualityComparer&lt;T&gt;</code> (сортировка не знает, как сравнивать), <code>StringComparer.OrdinalIgnoreCase</code>, политики Polly, <code>JsonNamingPolicy</code>. В современном C# простую стратегию проще передать делегатом <code>Func&lt;T, TResult&gt;</code> — это та же идея без иерархии классов. Выбор стратегии в рантайме обычно делает фабрика или словарь стратегий из DI (keyed services в .NET 8: <code>AddKeyedScoped</code> и <code>[FromKeyedServices]</code>).</p>
<p>Отличие от State: в Strategy алгоритм выбирает клиент, в State объект сам меняет своё поведение при переходах состояния.</p>

<h3>Decorator и Proxy</h3>
<p><strong>Decorator:</strong> динамически добавляет объекту обязанности, оборачивая его объектом с тем же интерфейсом. Гибкая альтернатива наследованию для расширения поведения.</p>
<pre><code>public sealed class CachingProductReader(IProductReader inner, HybridCache cache) : IProductReader
{
    public async Task&lt;ProductDto?&gt; GetAsync(Guid id, CancellationToken ct) =&gt;
        await cache.GetOrCreateAsync($"product:{id}",
            async token =&gt; await inner.GetAsync(id, token), cancellationToken: ct);
}

// Регистрация через Scrutor
services.AddScoped&lt;IProductReader, SqlProductReader&gt;();
services.Decorate&lt;IProductReader, CachingProductReader&gt;();</code></pre>
<p>В .NET: потоки — <code>BufferedStream</code>, <code>GZipStream</code>, <code>CryptoStream</code> оборачивают другой <code>Stream</code>; <code>DelegatingHandler</code> в <code>HttpClient</code> (хотя цепочка обработчиков — это ещё и Chain of Responsibility). Декораторы хороши для сквозной функциональности: кэш, логирование, метрики, ретраи — бизнес-класс о них не знает.</p>
<p><strong>Proxy</strong> структурно такой же (тот же интерфейс, ссылка на реальный объект), но цель другая — <em>контролировать доступ</em>: ленивое создание (virtual proxy), удалённый вызов (remote proxy — сгенерированные gRPC-клиенты), проверка прав (protection proxy). Ленивая загрузка навигационных свойств в EF Core через <code>UseLazyLoadingProxies()</code> и Castle DynamicProxy — реальные прокси. На вопрос «в чём разница» правильный ответ — в намерении: декоратор добавляет поведение, прокси управляет доступом к объекту.</p>

<h3>Factory Method, Abstract Factory, Builder</h3>
<p><strong>Factory Method</strong> (GoF): метод, который подклассы переопределяют, решая, какой конкретный объект создать. В повседневной речи «фабрикой» называют любой объект или метод, инкапсулирующий создание, — интервьюеры это обычно принимают, но полезно знать разницу. Ещё есть «static factory method» — именованный конструктор: <code>Money.FromRubles(100)</code>, <code>TimeSpan.FromSeconds(5)</code>. Он позволяет дать создание с осмысленным именем, вернуть кэшированный экземпляр или вернуть <code>Result</code> вместо исключения в конструкторе.</p>
<p><strong>Abstract Factory:</strong> интерфейс для создания <em>семейства</em> связанных объектов без указания конкретных классов. В .NET — <code>DbProviderFactory</code>: из неё получают согласованные <code>DbConnection</code>, <code>DbCommand</code>, <code>DbParameter</code> для одного провайдера (SqlClient, Npgsql).</p>
<p>Фабрики в .NET, которые стоит назвать: <code>IHttpClientFactory</code> (управляет временем жизни <code>HttpMessageHandler</code>, чтобы не исчерпать сокеты и учитывать DNS), <code>ILoggerFactory</code>, <code>IDbContextFactory&lt;T&gt;</code> (создание контекстов вне scope — в фоновых сервисах и Blazor).</p>
<p><strong>Builder:</strong> отделяет пошаговое конструирование сложного объекта от его представления.</p>
<pre><code>var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
var app = builder.Build();

var options = new DbContextOptionsBuilder&lt;AppDbContext&gt;()
    .UseNpgsql(connectionString)
    .EnableSensitiveDataLogging()
    .Options;</code></pre>
<p>В .NET: <code>StringBuilder</code>, <code>UriBuilder</code>, <code>WebApplicationBuilder</code>, <code>HostApplicationBuilder</code>, <code>DbContextOptionsBuilder</code>, <code>ModelBuilder</code> в EF Core. В тестах популярен Test Data Builder: <code>new OrderBuilder().WithLine(sku, 3).Confirmed().Build()</code> — тесты не ломаются при добавлении нового обязательного параметра в конструктор. В C# с init-свойствами, required-членами и record-ами с <code>with</code> необходимость в builder-ах для простых DTO почти отпала; он оправдан для объектов, где важен порядок шагов или валидация собранного целого.</p>

<h3>Adapter и Facade</h3>
<p><strong>Adapter:</strong> преобразует интерфейс класса в другой интерфейс, который ожидает клиент. Типичный сценарий — внешняя система с неудобным API, а у вас свой порт:</p>
<pre><code>// Порт, который нужен нашему домену
public interface IShippingLabels
{
    Task&lt;Label&gt; CreateAsync(Shipment shipment, CancellationToken ct);
}

// Адаптер к SOAP-клиенту перевозчика
public sealed class CarrierXLabels(CarrierXSoapClient client) : IShippingLabels
{
    public async Task&lt;Label&gt; CreateAsync(Shipment s, CancellationToken ct)
    {
        var response = await client.CreateWaybillAsync(new WaybillRequest
        {
            Weight_g = (int)(s.Weight.Kilograms * 1000),
            Dest = s.Address.ToCarrierFormat()
        });
        return new Label(response.WaybillNo, response.PdfBase64);
    }
}</code></pre>
<p>В hexagonal-архитектуре «адаптер» — именно это: реализация порта поверх конкретной технологии. В .NET адаптерами можно считать <code>StreamReader</code> (адаптирует байтовый <code>Stream</code> к текстовому <code>TextReader</code>) и провайдеры логирования, приводящие <code>ILogger</code> к Serilog или OpenTelemetry.</p>
<p><strong>Facade:</strong> единый упрощённый интерфейс к сложной подсистеме. Цель не в смене интерфейса, а в упрощении. В .NET — статический класс <code>File</code>: <code>File.ReadAllTextAsync(path)</code> прячет <code>FileStream</code>, буферизацию, определение кодировки и <code>StreamReader</code>. Внутренний SDK, который команда даёт другим командам, обычно и есть фасад: «вызови <code>ReserveAsync</code>», а под капотом ретраи, авторизация, сериализация и Kafka.</p>
<p>Разница одной фразой: адаптер делает существующий интерфейс <em>совместимым</em> с ожидаемым, фасад делает сложную подсистему <em>простой</em>. Риск фасада — превратиться в God Object, через который идёт всё.</p>

<h3>Observer</h3>
<p><strong>Намерение:</strong> определить зависимость «один ко многим», чтобы при изменении состояния одного объекта все зависимые уведомлялись автоматически. Субъект не знает конкретных подписчиков.</p>
<p>В .NET Observer встроен в язык: <code>event</code> и делегаты, <code>IObservable&lt;T&gt;</code>/<code>IObserver&lt;T&gt;</code> (основа Rx.NET), <code>INotifyPropertyChanged</code>, <code>IOptionsMonitor&lt;T&gt;.OnChange</code> и <code>IChangeToken</code> для перезагрузки конфигурации, <code>CancellationToken.Register</code>.</p>
<pre><code>public sealed class StockLevel
{
    public event EventHandler&lt;StockDepleted&gt;? Depleted;

    public void Take(int qty)
    {
        _quantity -= qty;
        if (_quantity == 0) Depleted?.Invoke(this, new StockDepleted(_sku));
    }
}</code></pre>
<p>Подводные камни, которые любят спрашивать: утечки памяти (издатель держит ссылку на подписчика через делегат, и долгоживущий издатель не даёт собрать короткоживущих подписчиков — надо отписываться); исключение в одном подписчике прерывает вызов остальных; синхронные события выполняются в потоке издателя. В распределённых системах идею Observer реализует pub/sub через брокер (Kafka, RabbitMQ), а внутри процесса — доменные события, рассылаемые через <code>INotification</code> в MediatR.</p>

<h3>Chain of Responsibility: middleware и MediatR pipeline</h3>
<p><strong>Классическое намерение GoF:</strong> избежать привязки отправителя запроса к получателю, давая шанс обработать запрос нескольким объектам. Объекты выстраиваются в цепочку, запрос передаётся по ней, пока кто-то его не обработает.</p>
<p>ASP.NET Core middleware — вариант этого паттерна, где каждое звено не «решает, обработать или передать», а может сделать что-то <em>до</em>, вызвать следующее звено и сделать что-то <em>после</em>, либо прервать цепочку (short-circuit):</p>
<pre><code>app.Use(async (context, next) =&gt;
{
    var sw = Stopwatch.StartNew();
    await next(context);                  // передаём дальше по цепочке
    logger.LogInformation("{Path} {Ms}", context.Request.Path, sw.ElapsedMilliseconds);
});

app.UseAuthentication();   // может прервать цепочку ответом 401
app.UseAuthorization();
app.MapControllers();</code></pre>
<p>MediatR <code>IPipelineBehavior&lt;TRequest, TResponse&gt;</code> устроен так же — делегат <code>next</code> вызывает следующее поведение или сам хендлер:</p>
<pre><code>public sealed class ValidationBehavior&lt;TRequest, TResponse&gt;(IEnumerable&lt;IValidator&lt;TRequest&gt;&gt; validators)
    : IPipelineBehavior&lt;TRequest, TResponse&gt; where TRequest : notnull
{
    public async Task&lt;TResponse&gt; Handle(TRequest request, RequestHandlerDelegate&lt;TResponse&gt; next, CancellationToken ct)
    {
        var failures = validators.Select(v =&gt; v.Validate(request)).SelectMany(r =&gt; r.Errors).ToList();
        if (failures.Count &gt; 0) throw new ValidationException(failures);
        return await next();
    }
}</code></pre>
<p>Ещё примеры: <code>DelegatingHandler</code> в <code>HttpClient</code>, фильтры MVC. Важная деталь, которую стоит упомянуть: <strong>порядок регистрации определяет порядок выполнения</strong>, и ошибка в порядке — частый баг (например, <code>UseAuthorization</code> до <code>UseRouting</code>, или поведение транзакции снаружи поведения логирования). Такую «луковицу» иногда называют Pipeline или Intercepting Filter — это близкий родственник CoR и Decorator.</p>

<h3>Template Method</h3>
<p><strong>Намерение:</strong> определить скелет алгоритма в базовом классе, оставив подклассам реализацию отдельных шагов. Порядок шагов фиксирует база («голливудский принцип»: не звоните нам, мы позвоним вам).</p>
<pre><code>public abstract class ImportJob
{
    public async Task RunAsync(Stream file, CancellationToken ct)   // скелет, не virtual
    {
        var rows = await ParseAsync(file, ct);
        var errors = Validate(rows);
        if (errors.Count &gt; 0) { await ReportAsync(errors, ct); return; }
        await SaveAsync(rows, ct);
    }

    protected abstract Task&lt;IReadOnlyList&lt;Row&gt;&gt; ParseAsync(Stream file, CancellationToken ct);
    protected virtual IReadOnlyList&lt;string&gt; Validate(IReadOnlyList&lt;Row&gt; rows) =&gt; [];
    protected abstract Task SaveAsync(IReadOnlyList&lt;Row&gt; rows, CancellationToken ct);
    protected virtual Task ReportAsync(IReadOnlyList&lt;string&gt; errors, CancellationToken ct) =&gt; Task.CompletedTask;
}</code></pre>
<p>В .NET: <code>BackgroundService</code> реализует <code>StartAsync</code>/<code>StopAsync</code> и вызывает ваш абстрактный <code>ExecuteAsync</code>; <code>DbContext</code> даёт хуки <code>OnModelCreating</code> и <code>OnConfiguring</code>; <code>JsonConverter&lt;T&gt;</code>; <code>Stream</code>, где асинхронные методы по умолчанию построены поверх синхронных. Минус — это наследование со всеми его проблемами. Ту же задачу часто решают композицией: скелет принимает стратегии шагов через конструктор.</p>

<h3>Singleton и почему его считают анти-паттерном</h3>
<p><strong>Намерение:</strong> гарантировать, что у класса один экземпляр, и дать к нему глобальную точку доступа. Потокобезопасная реализация в C#:</p>
<pre><code>public sealed class Clock
{
    private static readonly Lazy&lt;Clock&gt; _instance = new(() =&gt; new Clock());
    public static Clock Instance =&gt; _instance.Value;
    private Clock() { }
}</code></pre>
<p>Проблема не в «одном экземпляре», а во второй половине — <strong>глобальной точке доступа</strong>:</p>
<ul>
<li>скрытая зависимость: по конструктору класса не видно, что он ходит в <code>Clock.Instance</code>;</li>
<li>глобальное изменяемое состояние, которое протекает между тестами и не даёт запускать их параллельно;</li>
<li>невозможно подменить в тестах (классический пример — <code>DateTime.Now</code>; в .NET 8 для этого ввели абстракцию <code>TimeProvider</code>);</li>
<li>нарушение SRP: класс отвечает и за свою логику, и за управление своим временем жизни.</li>
</ul>
<p>Правильная альтернатива — <strong>singleton lifetime в DI-контейнере</strong>: <code>services.AddSingleton&lt;IClock, SystemClock&gt;()</code>. Экземпляр один, но зависимость явная и подменяемая. Здесь стоит упомянуть ловушку <strong>captive dependency</strong>: singleton, получивший в конструктор scoped-сервис (например, <code>DbContext</code>), удерживает его навсегда — один контекст на всё приложение с конкурентным доступом из разных запросов. В Development ASP.NET Core ловит это проверкой scope validation при сборке провайдера.</p>

<h3>Specification</h3>
<p>Паттерн не из GoF: его описали Эрик Эванс и Мартин Фаулер, и он входит в тактические паттерны DDD. <strong>Намерение:</strong> инкапсулировать бизнес-правило отбора в объект, который можно переиспользовать, комбинировать (И, ИЛИ, НЕ) и применять для трёх целей: проверки объекта, выборки из хранилища и описания того, что создать.</p>
<pre><code>public abstract class Specification&lt;T&gt;
{
    public abstract Expression&lt;Func&lt;T, bool&gt;&gt; ToExpression();
    public bool IsSatisfiedBy(T entity) =&gt; ToExpression().Compile()(entity);
}

public sealed class OverdueRentals(Instant now) : Specification&lt;Rental&gt;
{
    public override Expression&lt;Func&lt;Rental, bool&gt;&gt; ToExpression() =&gt;
        r =&gt; r.ReturnBy &lt; now &amp;&amp; r.ItemsOut &gt; 0;
}

var overdue = await db.Rentals.Where(new OverdueRentals(now).ToExpression()).ToListAsync(ct);</code></pre>
<p>Сила подхода в EF Core — <code>Expression</code> транслируется в SQL, и одно правило используется и в запросе, и в проверке в памяти. Известная реализация — библиотека Ardalis.Specification. Критика: для простых фильтров это лишняя церемония, а сложные спецификации с <code>Include</code>, сортировкой и пагинацией превращаются во второй язык запросов поверх LINQ. Хорошее применение — правило, которое встречается в нескольких местах и имеет доменное имя («просроченная аренда», «доступная к бронированию единица»).</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Чем Decorator отличается от Proxy и от Adapter?»</summary>
<p>Структурно Decorator и Proxy одинаковы: оба реализуют тот же интерфейс, что и обёрнутый объект, и делегируют ему вызовы. Различие в намерении: декоратор добавляет поведение — кэш, логирование, ретраи — и обычно декораторы собираются в цепочку; прокси контролирует доступ к объекту — откладывает его создание, проверяет права, представляет удалённый объект, как сгенерированный gRPC-клиент или ленивые прокси EF Core. Adapter отличается структурно: он меняет интерфейс, приводя чужой API к тому, который ожидает клиент, например оборачивает SOAP-клиент перевозчика в наш порт <code>IShippingLabels</code>. Коротко: декоратор — тот же интерфейс плюс поведение, прокси — тот же интерфейс плюс контроль доступа, адаптер — другой интерфейс.</p>
</details>
<details><summary>«Какие паттерны вы видите в ASP.NET Core?»</summary>
<p>Middleware — это Chain of Responsibility в варианте конвейера: каждое звено может обработать запрос до и после следующего или прервать цепочку. <code>WebApplication.CreateBuilder</code> и <code>DbContextOptionsBuilder</code> — Builder. <code>IHttpClientFactory</code> и <code>ILoggerFactory</code> — фабрики. <code>BackgroundService</code> — Template Method: база реализует жизненный цикл и вызывает ваш <code>ExecuteAsync</code>. <code>IOptionsMonitor.OnChange</code> — Observer. Фильтры MVC и <code>DelegatingHandler</code> у <code>HttpClient</code> — снова цепочки. Сам DI-контейнер реализует Inversion of Control, а его singleton lifetime — правильная замена паттерна Singleton. Если есть MediatR, то запросы — это Command, сам медиатор — Mediator, а pipeline behaviors — ещё одна цепочка.</p>
</details>
<details><summary>«Почему Singleton называют анти-паттерном? Как вы обходитесь без него?»</summary>
<p>Проблема Singleton не в единственности экземпляра, а в глобальном доступе: класс, обращающийся к <code>Something.Instance</code>, прячет зависимость, его нельзя понять по конструктору и сложно протестировать, потому что подменить синглтон нельзя, а его состояние протекает между тестами и мешает параллельному запуску. Это по сути глобальная переменная с красивым именем. Без него я регистрирую сервис с singleton lifetime в контейнере: экземпляр один, но приходит через конструктор и подменяется в тестах. Типичный пример — время: вместо <code>DateTime.UtcNow</code> внедряется <code>TimeProvider</code> или свой <code>IClock</code>. С singleton lifetime надо следить за потокобезопасностью и за captive dependency — нельзя держать в синглтоне scoped-зависимость вроде <code>DbContext</code>, для этого есть <code>IServiceScopeFactory</code> или <code>IDbContextFactory</code>.</p>
</details>
<details><summary>«Как устроен pipeline MediatR и какие поведения вы бы в него положили?»</summary>
<p>Каждый <code>IPipelineBehavior&lt;TRequest, TResponse&gt;</code> получает запрос и делегат <code>next</code>, и вызов <code>next</code> передаёт управление следующему поведению, а последнее звено — хендлеру. Это луковица: что-то до, вызов, что-то после, порядок определяется порядком регистрации. Типичный набор снаружи внутрь: логирование и метрики, обработка ошибок, валидация через FluentValidation, авторизация на уровне use case, транзакция или unit of work, кэш для запросов. Плюс подхода — сквозная функциональность пишется один раз и не может быть забыта в новом хендлере. Минусы — неявность, отладка через несколько уровней дженериков, и то, что поведение, которое переключается на тип ответа, ничего не знает о смысле операции. Я бы ещё отметил, что поведения, меняющие ответ (например, скрывающие поля по правам), должны покрывать все формы, в которых этот тип может оказаться внутри другого ответа, — иначе данные утекут через обёртку.</p>
</details>
<details><summary>«Strategy или просто switch? Как решаете?»</summary>
<p>Switch честнее, когда вариантов мало, они стабильны, а логика каждого короткая: три способа доставки, которые не меняются годами, читаются в одном месте лучше, чем в четырёх файлах. Strategy я выношу, когда варианты растут, каждый тянет свои зависимости — HTTP-клиент перевозчика, конфигурацию, — когда их нужно тестировать изолированно или выбирать по конфигурации, или когда их добавляют разные люди и конфликт в одном большом switch становится проблемой. Ещё сигнал — один и тот же switch по одному enum повторяется в нескольких местах: это знание о вариантах размазано, и стратегия собирает его в одном классе на вариант. В C# простая стратегия часто — просто делегат, а набор стратегий удобно получать из DI через keyed services или словарь по ключу.</p>
</details>
<details><summary>«Что такое паттерн Specification и где вы бы его применили?»</summary>
<p>Specification, описанный Эвансом и Фаулером, инкапсулирует бизнес-правило отбора в объект с методом <code>IsSatisfiedBy</code>, и такие объекты можно комбинировать через И, ИЛИ, НЕ. В связке с EF Core спецификация отдаёт <code>Expression&lt;Func&lt;T, bool&gt;&gt;</code>, поэтому одно правило работает и как фильтр в SQL, и как проверка в памяти. Применять его стоит для правил с доменным именем, которые используются в нескольких местах: «просроченный возврат» нужен в списке, в счётчике на дашборде и в напоминании, и если каждое место пишет свой where, они рано или поздно разойдутся. Для одноразовых фильтров он избыточен, а «универсальный» репозиторий, принимающий спецификацию с инклюдами, сортировкой и пагинацией, превращается в обёртку над LINQ без пользы. Критерий — в спецификацию выносится смысл, а не синтаксис запроса.</p>
</details>
<details><summary>«Template Method против Strategy: когда что?»</summary>
<p>Оба паттерна дают варьировать шаги алгоритма, но Template Method делает это наследованием, а Strategy — композицией. Template Method уместен, когда скелет алгоритма действительно фиксирован и принадлежит базе, а наследники заполняют пару шагов, — как <code>BackgroundService</code>, где жизненный цикл фреймворка не ваша забота. Strategy предпочтительнее, когда варьируемые шаги независимы друг от друга и могут комбинироваться, когда вариант выбирается в рантайме или когда шаги нужно тестировать отдельно. У Template Method есть все проблемы наследования: хрупкая база, один родитель, доступ к protected-деталям. Поэтому в прикладном коде я чаще передаю шаги через конструктор, а Template Method встречаю в основном в фреймворковых базовых классах.</p>
</details>
`
    },
    {
      id: 'enterprise-patterns',
      title: 'Паттерны enterprise-приложений',
      html: `
<h3>PoEAA: словарь enterprise-разработки</h3>
<p>Книга Мартина Фаулера «Patterns of Enterprise Application Architecture» (2002, PoEAA) описывает паттерны, из которых собраны почти все бизнес-приложения: как организовать логику, как отображать объекты на таблицы, как работать с конкурентностью и как передавать данные между слоями. Многие из них сегодня реализованы внутри ORM, и поэтому их перестали замечать, — но на собеседовании их любят спрашивать именно так: «какие паттерны реализует <code>DbContext</code>?», «чем Data Mapper отличается от Active Record?».</p>
<p>Главы этой книги, которые полезно держать в голове:</p>
<table>
<thead><tr><th>Группа</th><th>Паттерны</th></tr></thead>
<tbody>
<tr><td>Организация логики</td><td>Transaction Script, Domain Model, Table Module, Service Layer</td></tr>
<tr><td>Источники данных</td><td>Table/Row Data Gateway, Active Record, Data Mapper</td></tr>
<tr><td>Поведение ORM</td><td>Unit of Work, Identity Map, Lazy Load</td></tr>
<tr><td>Запросы</td><td>Repository, Query Object, Metadata Mapping</td></tr>
<tr><td>Конкурентность</td><td>Optimistic Offline Lock, Pessimistic Offline Lock, Coarse-Grained Lock</td></tr>
<tr><td>Распределение и базовые</td><td>DTO, Remote Facade, Mapper, Special Case, Value Object, Money</td></tr>
</tbody>
</table>
<p>В этой главе каждый паттерн разобран по схеме: проблема → решение → как это выглядит в .NET → цена и подводные камни → когда не применять. Repository и Unit of Work как архитектурный спор разобраны в главе о чистой архитектуре, Specification — в главе о GoF; здесь — их место в общей картине.</p>

<h3>Transaction Script, Domain Model, Table Module</h3>
<p>Три способа организовать бизнес-логику, которые Фаулер сравнивает по кривой «сложность логики → стоимость изменений».</p>
<p><strong>Transaction Script.</strong> Проблема: нужно выполнить бизнес-операцию. Решение: одна процедура на операцию, которая читает данные, проверяет, считает и пишет. Это хранимая процедура, метод сервиса или MediatR-хендлер, работающий напрямую с <code>DbContext</code> или Dapper.</p>
<pre><code>public async Task&lt;Result&gt; Handle(CancelOrder cmd, CancellationToken ct)
{
    var order = await db.Orders.SingleAsync(o =&gt; o.Id == cmd.OrderId, ct);
    if (order.Status is "Finished" or "Cancelled") return Errors.NotEditable;
    order.Status = "Cancelled";
    await db.Reservations.Where(r =&gt; r.OrderId == order.Id).ExecuteDeleteAsync(ct);
    await db.SaveChangesAsync(ct);
    return Result.Success();
}</code></pre>
<p>Плюсы: просто, понятно, быстро писать, транзакционная граница очевидна. Минусы: при росте правил скрипты начинают дублировать проверки (правило «завершённый заказ не редактируется» повторяется в каждом), и общие куски выносятся в хелперы с флагами. Хорош для простой логики и для отчётов; legacy с тысячами хранимых процедур — это Transaction Script в чистом виде.</p>
<p><strong>Domain Model.</strong> Решение: объектная модель предметной области, где данные и поведение вместе, а правила живут в объектах (глава о тактическом DDD). Дороже на старте — нужен маппинг, проектирование, понимание домена, — но стоимость изменений растёт медленно, потому что каждое правило записано в одном месте. Окупается при сложной логике с множеством переходов состояний и инвариантов.</p>
<p><strong>Table Module.</strong> Один класс на таблицу (а не на строку), который работает с набором записей: <code>OrdersModule.Cancel(dataSet, orderId)</code>. Фаулер связывал его с платформами, где есть удобный Record Set, и прямо называл .NET с его <code>DataSet</code> естественной средой. Сегодня в .NET он почти не встречается, но знать название полезно.</p>
<p><strong>Как выбирать:</strong> чем сложнее и изменчивее логика, тем больше оснований для Domain Model; простой CRUD и интеграционные операции — Transaction Script. И это можно смешивать в одной системе по фичам (vertical slices).</p>

<h3>Service Layer</h3>
<p><strong>Проблема.</strong> У приложения несколько клиентов (веб-API, очередь, фоновые задания), и каждому нужны одни и те же операции с транзакциями, авторизацией и координацией. Если логика координации в контроллерах, она дублируется для консьюмера Kafka.</p>
<p><strong>Решение.</strong> Слой сервисов задаёт границу приложения: набор доступных операций, каждая из которых координирует ответ — открывает транзакцию, загружает объекты, вызывает доменную логику, сохраняет, публикует события. У Фаулера два стиля: <em>domain facade</em> (тонкий слой над богатой моделью) и <em>operation script</em> (сервис сам содержит логику — по сути Transaction Script).</p>
<p><strong>В .NET</strong> это классы <code>OrderAppService</code> или, в современном варианте, MediatR-хендлеры — один хендлер на операцию. Это тот же Service Layer, нарезанный на отдельные классы.</p>
<p><strong>Подводные камни.</strong> Самый частый — «God service»: <code>OrderService</code> на три тысячи строк с двадцатью методами и десятью зависимостями, где каждая операция тянет все зависимости. Второй — бизнес-правила, перетёкшие из доменной модели в сервис, и анемичная модель в результате. Третий — сервисы, вызывающие друг друга по кругу.</p>
<p><strong>Когда не нужен.</strong> Если у приложения один клиент и логика тривиальна, слой сервисов между контроллером и <code>DbContext</code> только пробрасывает вызовы.</p>

<h3>Active Record и Data Mapper</h3>
<p><strong>Active Record.</strong> Объект оборачивает строку таблицы, содержит её данные и сам умеет себя загружать и сохранять: <code>var order = Order.Find(id); order.Status = "Paid"; order.Save();</code>. Классика — Ruby on Rails, Laravel Eloquent; в .NET — Castle ActiveRecord (давно не развивается) и ряд легковесных библиотек. Плюсы: очень мало кода для CRUD, модель совпадает со схемой. Минусы: доменная модель привязана к структуре таблиц и к инфраструктуре (статические методы доступа к базе), её трудно тестировать без базы, а сложное поведение, не совпадающее с таблицей, ложится плохо.</p>
<p><strong>Data Mapper.</strong> Отдельный слой мапперов переносит данные между объектами и базой, и объекты не знают о базе вообще. EF Core и NHibernate — Data Mapper: доменный класс <code>Order</code> — обычный C#-класс, а <code>DbContext</code> с конфигурацией маппинга сохраняет и загружает его. Плюсы: модель и схема развиваются независимо, модель тестируется без базы, persistence ignorance. Минусы: сам маппер — сложный механизм (change tracking, конфигурация, неожиданные запросы), за который платят производительностью и обучением.</p>
<p><strong>Где Dapper.</strong> Это micro-ORM: он маппит результат SQL-запроса на объект, но не отслеживает изменения и не генерирует запросы. Его используют в стиле Table Data Gateway (класс со SQL-запросами к таблице) или для read-стороны CQRS, где нужна полная власть над SQL.</p>
<pre><code>// Active Record (стиль, не EF):
order.Confirm(); order.Save();

// Data Mapper (EF Core): объект не знает о базе
order.Confirm();
await dbContext.SaveChangesAsync(ct);</code></pre>
<p>На собеседовании: «EF Core — это Data Mapper, плюс Unit of Work, Identity Map и Lazy Load, плюс <code>DbSet</code> как Repository и LINQ как Query Object».</p>

<h3>Unit of Work, Identity Map и Lazy Load</h3>
<p><strong>Unit of Work.</strong> Проблема: в бизнес-операции меняются несколько объектов, и нужно записать изменения согласованно, одной транзакцией и без лишних запросов. Решение: объект, который отслеживает новые, изменённые и удалённые объекты и в конце записывает всё разом. В EF Core это <code>DbContext</code>: change tracker помнит исходные значения загруженных сущностей, <code>SaveChanges</code> вычисляет разницу, сортирует операции с учётом внешних ключей и выполняет их в одной транзакции (по умолчанию). Подводный камень — долгоживущий контекст: он копит отслеживаемые объекты, медленнее работает и хранит устаревшие данные; поэтому контекст живёт в пределах одного запроса или одной операции.</p>
<p><strong>Identity Map.</strong> Проблема: если одну и ту же строку загрузить дважды, получатся два объекта, и изменения одного затрут изменения другого. Решение: карта «ключ → загруженный объект», которая гарантирует один экземпляр на ключ в пределах сессии. В EF Core change tracker и есть Identity Map: второй запрос того же заказа вернёт <em>тот же экземпляр</em> (и не перезапишет его несохранённые изменения данными из базы), а <code>Find</code>/<code>FindAsync</code> сначала смотрит в отслеживаемые объекты и может вовсе не пойти в базу. С <code>AsNoTracking()</code> карта не используется, и одна строка, встреченная в результате дважды, станет двумя объектами; <code>AsNoTrackingWithIdentityResolution()</code> разрешает идентичность в пределах запроса без отслеживания.</p>
<p><strong>Lazy Load.</strong> Проблема: граф объектов большой, и загружать его целиком ради одного поля дорого. Решение: объект содержит не данные, а маркер, по которому данные подгружаются при первом обращении. Варианты у Фаулера — lazy initialization, virtual proxy, value holder, ghost. В EF Core — <code>UseLazyLoadingProxies()</code> (прокси-наследники с <code>virtual</code>-навигациями) или внедрение <code>ILazyLoader</code>. Цена: <strong>проблема N+1</strong> — цикл по ста заказам, обращающийся к <code>order.Customer</code>, делает сто один запрос; неожиданные запросы в сериализации и после закрытия контекста; для доменной модели — агрегат, загруженный наполовину. Поэтому в серверных приложениях ленивую загрузку обычно выключают и загружают явно: <code>Include</code> для агрегатов, проекции <code>Select</code> для чтения, <code>AsSplitQuery()</code> против картезианского взрыва при нескольких коллекциях.</p>

<h3>Repository и Query Object</h3>
<p><strong>Repository</strong> (Фаулер, затем Эванс в DDD) — посредник между доменом и слоем маппинга с интерфейсом коллекции: «дай заказ по id», «добавь заказ». В EF Core <code>DbSet&lt;T&gt;</code> уже обладает этим интерфейсом. Свой репозиторий имеет смысл как <em>репозиторий агрегата</em> — узкий, на языке домена, всегда загружающий агрегат целиком; generic-репозиторий поверх EF — обычно вред (подробно в главе о чистой архитектуре).</p>
<p><strong>Query Object.</strong> Проблема: запросы собираются динамически из критериев (фильтры списка), и писать SQL-строки конкатенацией опасно и неудобно. Решение: объект, представляющий запрос в терминах модели, который сам переводится в SQL. LINQ над <code>IQueryable</code> в EF Core — это и есть Query Object, встроенный в язык: дерево выражений строится из вызовов <code>Where</code> и <code>OrderBy</code> и транслируется провайдером. Спецификация (Эванс и Фаулер) — именованный кусок такого запроса с доменным смыслом.</p>
<pre><code>IQueryable&lt;Order&gt; query = db.Orders.AsNoTracking();
if (filter.CounterpartyId is { } c) query = query.Where(o =&gt; o.CounterpartyId == c);
if (filter.From is { } from)         query = query.Where(o =&gt; o.EndsAt &gt;= from);
if (filter.OnlyOverdue)              query = query.Where(new OverdueOrders(now).ToExpression());
var page = await query.OrderBy(o =&gt; o.StartsAt).Skip(skip).Take(take).ToListAsync(ct);</code></pre>
<p>Подводные камни: выражение, которое провайдер не может перевести, в EF Core 3+ бросает исключение (раньше молча вычислялось в памяти); опасно отдавать <code>IQueryable</code> за пределы слоя — вызывающий может построить что угодно, включая тяжёлый запрос без индекса.</p>

<h3>Optimistic и Pessimistic Offline Lock</h3>
<p>«Offline» у Фаулера означает блокировку, охватывающую <strong>бизнес-транзакцию длиннее одной транзакции базы</strong>: пользователь открыл заказ, редактировал десять минут и нажал «Сохранить». Транзакцию базы десять минут держать нельзя.</p>
<p><strong>Optimistic Offline Lock.</strong> Проблема: два пользователя открыли одну запись, оба сохранили, второй молча затёр изменения первого (lost update). Решение: у записи есть версия; при сохранении проверяется, что версия та же, что была при чтении, иначе — конфликт.</p>
<pre><code>// EF Core: токен конкурентности
modelBuilder.Entity&lt;Order&gt;().Property(o =&gt; o.Version).IsRowVersion();   // SQL Server rowversion; в Npgsql xmin
// UPDATE orders SET ... WHERE id = @id AND version = @originalVersion  → 0 строк → DbUpdateConcurrencyException

// HTTP: версия уходит клиенту как ETag и возвращается в If-Match
// несовпадение → 412 Precondition Failed или 409 Conflict</code></pre>
<p>Плюсы: никаких блокировок, хорошо масштабируется. Минусы: конфликт обнаруживается в момент сохранения, и пользователь теряет работу, если не предусмотреть слияние или повтор. Подходит, когда конфликты редки.</p>
<p><strong>Pessimistic Offline Lock.</strong> Решение: перед началом редактирования взять блокировку («документ редактирует Иванов»), и остальные не могут начать. Реализуется таблицей блокировок с владельцем и временем истечения, потому что транзакции базы для этого не подходят. Обязателен таймаут (пользователь закрыл вкладку), снятие администратором и честный UX. Подходит, когда конфликты часты и потеря работы дорога.</p>
<p>Не путайте с <strong>пессимистической блокировкой внутри одной транзакции</strong>: <code>SELECT ... FOR UPDATE</code> в PostgreSQL блокирует строку до конца текущей транзакции. Это полезный инструмент для коротких критичных секций — проверить остаток и списать под блокировкой, — но не для блокировки на время работы человека. Похожую роль играют advisory locks: <code>pg_advisory_xact_lock(hash)</code> сериализует операции над одним продуктом без блокировки конкретных строк.</p>

<h3>DTO и Mapper</h3>
<p><strong>Data Transfer Object.</strong> У Фаулера проблема — удалённые вызовы дорогие, поэтому нужен объект, который за один вызов переносит много данных. Сегодня DTO решают ещё одну задачу — <strong>отделить контракт API от доменной модели</strong>: внутренняя модель может меняться, а внешний контракт стабилен; в ответ не утекают поля, которые клиенту видеть нельзя; нет циклических ссылок при сериализации. В C# DTO удобно делать <code>record</code>-ами.</p>
<p><strong>Mapper</strong> — объект, который переносит данные между двумя представлениями, не давая им знать друг о друге. Варианты в .NET:</p>
<ul>
<li><strong>Ручной маппинг</strong> (метод расширения или статический метод) — явно, быстро, ошибки видны компилятору, но многословно.</li>
<li><strong>Проекция в запросе</strong> (<code>Select(o =&gt; new OrderDto(...))</code>) — для чтения лучший вариант: из базы выбираются только нужные колонки.</li>
<li><strong>AutoMapper</strong> — маппинг по соглашениям через рефлексию. Критика: ошибки маппинга обнаруживаются в рантайме, логика прячется в профилях, «Find Usages» не находит присваивания. С 2025 года, как и MediatR, распространяется под коммерческой лицензией для коммерческого использования выше порога.</li>
<li><strong>Mapperly</strong> — source generator: генерирует обычный код маппинга на этапе компиляции, без рефлексии, с предупреждениями о несмапленных полях.</li>
</ul>
<p>Подводные камни: DTO, совпадающий с сущностью один в один, — признак, что он не нужен или что API — просто проброс таблицы; общий DTO для чтения и записи смешивает разные контракты; маппинг, в который просочилась бизнес-логика.</p>

<h3>Null Object и Result</h3>
<p><strong>Null Object</strong> (Бобби Вулф; у Фаулера в PoEAA близкий паттерн называется Special Case). Проблема: код полон проверок <code>if (x != null)</code>, и забытая проверка — <code>NullReferenceException</code>. Решение: объект с тем же интерфейсом, который ничего не делает или возвращает нейтральное значение. В .NET: <code>NullLogger.Instance</code>, <code>Stream.Null</code>, <code>Task.CompletedTask</code>, <code>Array.Empty&lt;T&gt;()</code> и <code>Enumerable.Empty&lt;T&gt;()</code> (пустая коллекция вместо null — тот же принцип).</p>
<pre><code>public sealed class NoDiscount : IDiscountPolicy
{
    public static readonly NoDiscount Instance = new();
    public Money Apply(Money total) =&gt; total;
}</code></pre>
<p>Когда не применять: если отсутствие значения — значимый случай, который вызывающий <em>должен</em> обработать (заказ не найден), Null Object его скроет. Тогда лучше nullable reference types с <code>?</code> и анализом компилятора, или Result.</p>
<p><strong>Result / Either.</strong> Функциональный паттерн: операция возвращает либо успех со значением, либо ошибку, и это видно в сигнатуре. Вызывающий узнаёт о возможном отказе из типа, а не из документации, как с исключением. Оговорка: отбросить возвращённый Result C# не запрещает — это ловят анализаторы, а не компилятор. Подробно — в главе об обработке ошибок; здесь важно, что Result — тоже enterprise-паттерн, решающий проблему «как сообщить о бизнес-отказе без исключения».</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Какие паттерны PoEAA реализует EF Core?»</summary>
<p>EF Core — это Data Mapper: доменные классы не знают о базе, а маппинг описан отдельно, в Fluent API или соглашениях. <code>DbContext</code> — Unit of Work: change tracker отслеживает новые, изменённые и удалённые сущности, и <code>SaveChanges</code> записывает разницу одной транзакцией. Тот же трекер — Identity Map: в пределах контекста одна строка соответствует одному экземпляру, а <code>Find</code> сначала ищет среди отслеживаемых. <code>DbSet</code> — Repository с интерфейсом коллекции. LINQ поверх <code>IQueryable</code> — Query Object, транслируемый в SQL. Ленивая загрузка через прокси — Lazy Load в виде virtual proxy. Конфигурация моделей — Metadata Mapping, а токены конкурентности — Optimistic Offline Lock. Поэтому писать поверх EF свой generic-репозиторий и Unit of Work — дублировать то, что уже есть.</p>
</details>
<details><summary>«Чем Active Record отличается от Data Mapper?»</summary>
<p>В Active Record объект оборачивает строку и сам себя загружает и сохраняет — у него есть <code>Save</code>, <code>Find</code>, <code>Delete</code>, — и модель повторяет структуру таблицы. Это очень продуктивно для CRUD, как в Rails, но связывает модель с базой и мешает тестировать и развивать модель, отличающуюся от схемы. В Data Mapper отдельный слой переносит данные между объектами и таблицами, и объекты о базе не знают; это EF Core и NHibernate. Цена Data Mapper — сложность самого маппера и его поведения: change tracking, неочевидные запросы. Для богатой доменной модели я выбираю Data Mapper, для простого CRUD разница не так важна.</p>
</details>
<details><summary>«Что такое Identity Map и как он проявляется в EF Core?»</summary>
<p>Identity Map гарантирует, что в пределах сессии одна строка базы представлена одним объектом в памяти, иначе два экземпляра одной записи разойдутся и затрут изменения друг друга. В EF Core это change tracker: повторный запрос той же сущности в том же контексте вернёт тот же экземпляр, и данные из базы не перезапишут уже отслеживаемые значения — иногда это сюрприз, когда ожидаешь свежие данные. <code>Find</code> вообще не пойдёт в базу, если сущность уже отслеживается. С <code>AsNoTracking</code> идентичность не разрешается, и одна строка в результате может стать несколькими объектами; для этого есть <code>AsNoTrackingWithIdentityResolution</code>. Отсюда и практическое правило: контекст короткоживущий, на один запрос или операцию.</p>
</details>
<details><summary>«Почему ленивую загрузку часто отключают? Что такое N+1?»</summary>
<p>Ленивая загрузка подгружает навигационное свойство при первом обращении, и это удобно, пока не появляется цикл: пройти по ста заказам и обратиться к клиенту каждого — сто один запрос, это проблема N+1. Запросы становятся неявными — они происходят при сериализации, в шаблонах, в логировании, — и их не видно в коде хендлера. Для доменной модели ленивая загрузка опасна ещё и тем, что агрегат загружается частично и проверка инварианта может пройти по неполным данным. Поэтому в серверных приложениях я загружаю явно: агрегаты через <code>Include</code> в репозитории, чтения — проекцией в DTO, при нескольких коллекциях — <code>AsSplitQuery</code>, чтобы не получить картезианский взрыв. N+1 ищу по логам SQL и метрикам числа запросов на endpoint.</p>
</details>
<details><summary>«Как защититься от потерянного обновления, когда пользователь редактирует запись долго?»</summary>
<p>Это задача offline lock. По умолчанию — оптимистическая блокировка: у записи версия, она отдаётся клиенту, например как ETag, и возвращается при сохранении в If-Match; сервер выполняет обновление с условием на версию, и если строк обновилось ноль, отвечает конфликтом. В EF Core это токен конкурентности — <code>rowversion</code> в SQL Server, <code>xmin</code> в PostgreSQL — и <code>DbUpdateConcurrencyException</code>. Клиент при конфликте показывает изменения и предлагает слить или перезагрузить. Если конфликты частые и потеря работы дорогая, — пессимистическая offline-блокировка: таблица блокировок с владельцем и сроком истечения, с принудительным снятием. Держать транзакцию базы открытой на время работы человека нельзя никогда.</p>
</details>
<details><summary>«Transaction Script или Domain Model — как выбираете?»</summary>
<p>По сложности и изменчивости правил. Transaction Script — процедура на операцию — дешевле на старте и понятнее, когда правил мало: импорт, отчёт, простой CRUD. Но с ростом правил скрипты дублируют проверки, и одно правило оказывается в пяти местах в слегка разных вариантах. Domain Model дороже на старте — маппинг, проектирование, — зато каждое правило живёт в одном объекте и стоимость изменений растёт медленно. Я не выбираю одно на всю систему: ядро с заказами, деньгами и бронированиями — доменная модель, справочники и интеграции — скрипты, и вертикальные срезы позволяют такую неоднородность. Признак, что пора переходить к модели, — одинаковые проверки состояния в нескольких хендлерах.</p>
</details>
<details><summary>«Нужен ли AutoMapper?»</summary>
<p>Он экономит строки, но прячет маппинг: ошибки в соглашениях обнаруживаются только в рантайме, присваивания не находятся поиском, а в профилях со временем появляется логика. Для чтения я предпочитаю проекцию прямо в запросе — так из базы выбираются только нужные колонки. Для остального — ручной маппинг методами расширения или Mapperly, который генерирует обычный код на этапе компиляции и предупреждает о несмапленных полях. Ещё один аргумент последних лет — с 2025 года AutoMapper, как и MediatR, распространяется под коммерческой лицензией для компаний выше порога. Если в проекте он уже есть, обязательно держать тест конфигурации, проверяющий, что все поля смаплены.</p>
</details>
`
    },
    {
      id: 'clean',
      title: 'Чистая архитектура и слои',
      html: `
<h3>Классическая слоёная архитектура</h3>
<p>Самая старая и самая распространённая схема — <strong>layered architecture</strong>, N-tier: Presentation (контроллеры, UI) → Business Logic (сервисы) → Data Access (репозитории, SQL) → база. Каждый слой зависит только от слоя ниже.</p>
<pre><code>Web       → ссылается на BLL
BLL       → ссылается на DAL
DAL       → ссылается на EF Core / Dapper / ADO.NET</code></pre>
<p>Достоинства: понятно любому разработчику, легко объяснить, естественно разделяет UI и данные. Главный недостаток — <strong>бизнес-логика зависит от доступа к данным</strong>. Сущности часто описываются как классы EF в DAL, и BLL работает с ними; смена хранилища, тестирование бизнес-правил без базы и даже простое понимание, где живут правила, становятся трудными. На практике такая схема дрейфует к анемичной модели: сущности — мешки свойств, «сервисы» — процедуры, а правила расползаются между сервисами, контроллерами и хранимыми процедурами.</p>
<p>Это не значит, что слоёная архитектура плоха. Для CRUD-приложения, где почти нет правил, она — разумный выбор. Проблемы начинаются, когда бизнес-логика становится центром ценности системы, а архитектура ставит в центр базу данных.</p>
<blockquote><strong>Важно.</strong> Сильный ответ на собеседовании начинается не с «чистая архитектура лучше», а с вопроса: где в этой системе сложность? Если сложность в данных и интеграциях — один выбор, если в бизнес-правилах — другой.</blockquote>

<h3>Hexagonal: порты и адаптеры</h3>
<p>Алистер Кокберн описал <strong>Hexagonal Architecture</strong> (другое название — Ports and Adapters) в 2005 году. Идея: приложение — это ядро, которое общается с внешним миром только через <strong>порты</strong> — интерфейсы, определённые на языке ядра. Внешние технологии подключаются <strong>адаптерами</strong>, реализующими или вызывающими эти порты. Шестиугольник — просто картинка, количество сторон ничего не значит.</p>
<p>Порты бывают двух видов:</p>
<ul>
<li><strong>Driving (primary, входящие)</strong> — через них мир управляет приложением: use case-ы. Адаптеры — HTTP-контроллер, gRPC-сервис, консьюмер Kafka, CLI, тест.</li>
<li><strong>Driven (secondary, исходящие)</strong> — через них приложение использует внешние системы: хранилище, брокер, почта, внешний API. Адаптеры — репозиторий на EF Core, продюсер Kafka, HTTP-клиент.</li>
</ul>
<pre><code>// Driving port
public interface IReserveStock
{
    Task&lt;Result&lt;ReservationId&gt;&gt; HandleAsync(ReserveStockCommand cmd, CancellationToken ct);
}

// Driven port — объявлен ядром
public interface IStockStore
{
    Task&lt;StockItem?&gt; FindAsync(Sku sku, WarehouseId wh, CancellationToken ct);
    Task SaveAsync(StockItem item, CancellationToken ct);
}

// Driving adapter — Kafka consumer вызывает тот же use case, что и контроллер
public sealed class OrderPlacedConsumer(IReserveStock reserve) { ... }</code></pre>
<p>Главная ценность — <strong>симметрия</strong>: для ядра нет разницы, пришёл вызов из HTTP или из Kafka, лежат данные в PostgreSQL или в памяти теста. Отсюда простое тестирование ядра без инфраструктуры и возможность сменить технологию на краю, не трогая логику.</p>

<h3>Onion и Clean Architecture, правило зависимостей</h3>
<p><strong>Onion Architecture</strong> (Джеффри Палермо, 2008) и <strong>Clean Architecture</strong> (Роберт Мартин, статья 2012 и книга 2017) — вариации той же идеи, нарисованные концентрическими кругами. У Мартина круги: Entities (корпоративные бизнес-правила) → Use Cases (правила приложения) → Interface Adapters (контроллеры, презентеры, гейтвеи) → Frameworks and Drivers (веб, БД, UI).</p>
<p>Центральное правило всех трёх — <strong>The Dependency Rule</strong>: зависимости в исходном коде могут указывать только внутрь. Внутренний круг ничего не знает о внешних: ни имён классов, ни функций, ни форматов данных. Поток управления при этом идёт наружу (use case вызывает репозиторий), и именно DIP разворачивает зависимость: интерфейс объявлен внутри, реализация снаружи.</p>
<p>Типичная раскладка .NET-решения:</p>
<pre><code>src/
  Shop.Domain          ← сущности, value objects, доменные события, доменные ошибки. Ни одной ссылки на инфраструктуру
  Shop.Application     ← use cases (команды/запросы, хендлеры), порты (интерфейсы), DTO. Ссылается на Domain
  Shop.Infrastructure  ← EF Core DbContext, конфигурации, адаптеры Kafka/HTTP. Ссылается на Application
  Shop.Api             ← контроллеры/endpoints, Composition Root. Ссылается на всё для сборки DI</code></pre>
<p>Правило проверяется автоматически: граф ссылок проектов уже не даст Domain сослаться на Infrastructure, а тонкие правила («Application не использует <code>Microsoft.EntityFrameworkCore</code>») удобно закреплять архитектурными тестами (NetArchTest, ArchUnitNET).</p>
<p>Различия между тремя схемами на собеседовании обычно не важны; важно понимать общее — <strong>ядро в центре, инфраструктура — деталь, зависимости направлены к ядру</strong>. Если спросят «в чём разница», можно сказать: hexagonal акцентирует симметрию входов и выходов через порты, onion и clean — концентрические слои внутри ядра (домен отдельно от прикладного слоя).</p>

<h3>Где место EF Core</h3>
<p>Формально EF Core — инфраструктура, внешний круг. Но в .NET это спорный момент, потому что EF Core в значительной степени умеет работать с «чистыми» доменными классами:</p>
<ul>
<li>маппинг через Fluent API в <code>IEntityTypeConfiguration&lt;T&gt;</code>, лежащих в Infrastructure, без атрибутов в домене;</li>
<li>приватные сеттеры, backing fields (<code>HasField</code>, <code>UsePropertyAccessMode</code>), приватные конструкторы для материализации;</li>
<li>value objects через owned types (<code>OwnsOne</code>, <code>OwnsMany</code>), complex types (EF Core 8+) и <code>HasConversion</code> для однополевых значений;</li>
<li>коллекции через <code>IReadOnlyCollection&lt;T&gt;</code> поверх приватного <code>List&lt;T&gt;</code>.</li>
</ul>
<p>Поэтому распространённая позиция: <strong>Domain не ссылается на EF Core вообще</strong>, <code>DbContext</code> и конфигурации живут в Infrastructure. А вот насчёт Application мнения расходятся:</p>
<ul>
<li><strong>Строгая позиция:</strong> Application знает только свои порты (<code>IOrderRepository</code>, <code>IUnitOfWork</code>), EF Core видит только Infrastructure.</li>
<li><strong>Прагматичная позиция</strong> (её придерживаются многие известные шаблоны, например Jason Taylor's Clean Architecture template): Application объявляет <code>IApplicationDbContext</code> с <code>DbSet&lt;T&gt;</code>, и хендлеры пишут LINQ напрямую. Это означает зависимость Application от пакета EF Core, но избавляет от слоя репозиториев.</li>
</ul>
<p>Честный компромисс, который хорошо звучит на собеседовании: доменная модель изолирована от EF, а в прикладном слое запросы (read side) идут через EF/Dapper напрямую, потому что абстрагировать <code>IQueryable</code> всё равно не получится без потерь, а команды (write side) загружают и сохраняют агрегаты.</p>

<h3>Repository и Unit of Work поверх EF Core: спор</h3>
<p>Фаулер в PoEAA определяет <strong>Repository</strong> как посредника между доменом и слоем маппинга данных, работающего как коллекция доменных объектов в памяти. <strong>Unit of Work</strong> — объект, который отслеживает изменения в рамках бизнес-транзакции и координирует их запись. Документация Microsoft прямо говорит, что <code>DbContext</code> — это уже Unit of Work, а <code>DbSet&lt;T&gt;</code> — уже репозиторий. Отсюда спор.</p>
<p><strong>Аргументы против своего репозитория поверх EF:</strong></p>
<ul>
<li>двойная абстракция: generic <code>IRepository&lt;T&gt;</code> с <code>GetAll</code>, <code>Find(Expression)</code>, <code>Add</code>, <code>Update</code> — это обёртка над <code>DbSet</code>, теряющая <code>Include</code>, проекции, <code>AsNoTracking</code>, <code>ExecuteUpdate</code>;</li>
<li>«чтобы можно было сменить ORM» почти никогда не случается, а если случается, абстракция оказывается протекающей;</li>
<li>возврат <code>IQueryable</code> из репозитория — протечка: запрос формирует вызывающий, и репозиторий ничего не инкапсулирует.</li>
</ul>
<p><strong>Аргументы за:</strong></p>
<ul>
<li>репозиторий <em>агрегата</em> (а не generic) выражает язык домена и границу: <code>IOrderRepository.GetAsync(id)</code> всегда загружает заказ целиком со строками, и никто не забудет <code>Include</code>, нарушив инварианты;</li>
<li>доменный и прикладной код не зависят от EF и тестируются без провайдера;</li>
<li>в одном месте собраны запросы к агрегату, удобно оптимизировать.</li>
</ul>
<pre><code>// Репозиторий агрегата — узкий, по языку домена
public interface IOrderRepository
{
    Task&lt;Order?&gt; GetAsync(OrderId id, CancellationToken ct);   // всегда целиком
    void Add(Order order);
}

internal sealed class OrderRepository(AppDbContext db) : IOrderRepository
{
    public Task&lt;Order?&gt; GetAsync(OrderId id, CancellationToken ct) =&gt;
        db.Orders.Include(o =&gt; o.Lines).Include(o =&gt; o.Steps)
                 .SingleOrDefaultAsync(o =&gt; o.Id == id, ct);

    public void Add(Order order) =&gt; db.Orders.Add(order);
}</code></pre>
<p>Позиция senior: <strong>generic-репозиторий над EF — почти всегда вред; репозиторий агрегата — разумен, если модель богатая; для запросов на чтение — никаких репозиториев, прямые проекции</strong>. Тестировать доступ к данным лучше с настоящей базой (Testcontainers), а не с InMemory-провайдером, который не проверяет транзакции, констрейнты и трансляцию в SQL.</p>

<h3>Vertical Slice Architecture</h3>
<p>Джимми Богард (автор MediatR) популяризировал <strong>Vertical Slice Architecture</strong>: вместо горизонтальных слоёв код организуется вертикальными срезами — одна фича (use case) от endpoint-а до базы в одной папке. Цель — минимизировать связанность (coupling) <em>между</em> срезами и максимизировать её <em>внутри</em> среза.</p>
<pre><code>Features/
  Orders/
    CreateOrder/
      CreateOrderEndpoint.cs
      CreateOrderCommand.cs
      CreateOrderHandler.cs
      CreateOrderValidator.cs
    CancelOrder/
      ...
    GetOrderDetails/
      GetOrderDetailsQuery.cs      ← читает через Dapper или EF-проекцию напрямую
      OrderDetailsDto.cs</code></pre>
<p>Принципы: каждый срез сам решает, насколько сложной ему быть (CRUD-срез пишет в <code>DbContext</code> напрямую, сложный — работает через доменную модель); общие абстракции появляются только когда реально нужны; добавление фичи — добавление файлов, а не правка общих сервисов. Хорошо сочетается с CQRS и MediatR.</p>
<p>Вертикальные срезы <strong>не противоречат</strong> доменной модели: домен остаётся общим ядром (агрегаты, value objects), а срезы — это организация прикладного слоя. Риск — дублирование логики между срезами и «свалка» в общем Shared-проекте. Лечится тем же DDD: общая логика — в доменные объекты, а не в общие сервисы.</p>

<h3>Когда слои — это overkill</h3>
<p>Многослойная архитектура стоит денег: больше проектов и файлов, маппинг DTO ↔ команды ↔ сущности, интерфейсы с одной реализацией, длинный путь от запроса до SQL. Это окупается, когда:</p>
<ul>
<li>бизнес-правил много, и они — ценность системы (заказы, деньги, бронирования);</li>
<li>система живёт годами и её меняют разные люди;</li>
<li>несколько входов (HTTP, очередь, джобы) должны исполнять одни и те же сценарии;</li>
<li>нужно тестировать правила быстро и изолированно.</li>
</ul>
<p>Не окупается для: CRUD-админок, прототипов, маленьких сервисов-адаптеров (сервис, который читает топик и пишет в другой), BFF, отчётов. Там минимальный API с прямым использованием <code>DbContext</code> честнее. Хороший маркер переусложнения — «сервис», который вызывает репозиторий, который вызывает <code>DbContext</code>, и ни один уровень не добавляет логики.</p>
<p>Ещё одна мысль: архитектура должна позволять разным частям системы иметь разную сложность. Ядро с деньгами — богатая модель и порты; справочники — CRUD; отчёты — SQL. Попытка натянуть одну схему на всё — источник лишней работы.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Что такое правило зависимостей в Clean Architecture и как вы его соблюдаете в .NET-решении?»</summary>
<p>Правило зависимостей говорит, что зависимости в исходном коде указывают только внутрь, к домену: внутренние круги ничего не знают о внешних. Поток управления при этом идёт наружу — use case вызывает репозиторий, — и разворачивается это через инверсию зависимостей: порт объявлен в прикладном слое, реализация лежит в инфраструктуре. В .NET я закрепляю это структурой проектов: Domain без ссылок на инфраструктурные пакеты, Application ссылается на Domain, Infrastructure — на Application, а API собирает всё в Composition Root. Граф ссылок проектов сам не даст сослаться в обратную сторону, а более тонкие правила, например запрет на использование EF Core в Domain или на ссылки между модулями, проверяют архитектурные тесты на NetArchTest или ArchUnitNET в CI. Без автоматической проверки такие правила деградируют за несколько месяцев.</p>
</details>
<details><summary>«Нужен ли репозиторий поверх EF Core?»</summary>
<p>Generic-репозиторий поверх EF — почти всегда нет: <code>DbContext</code> уже Unit of Work, <code>DbSet</code> уже репозиторий, а обёртка с <code>GetAll</code> и <code>Find(Expression)</code> теряет проекции, <code>Include</code>, <code>AsNoTracking</code> и пакетные операции, не давая ничего взамен; аргумент «сменим ORM» в реальности не срабатывает. Репозиторий агрегата — другое дело: <code>IOrderRepository.GetAsync</code> загружает заказ всегда целиком с его строками, выражает границу агрегата и не даёт половине кода забыть <code>Include</code> и сохранить частично загруженный агрегат. На чтение я репозитории не использую — запросы делают проекции в DTO напрямую через EF или Dapper. Тестирую доступ к данным на настоящем PostgreSQL в Testcontainers, потому что InMemory-провайдер не проверяет ни транзакции, ни констрейнты, ни трансляцию запросов.</p>
</details>
<details><summary>«Чем hexagonal отличается от слоёной архитектуры?»</summary>
<p>В слоёной архитектуре зависимости идут сверху вниз до базы: бизнес-логика зависит от слоя доступа к данным, и база оказывается в фундаменте. В hexagonal в центре приложение, а база, UI, брокеры и внешние API — равноправные внешние детали, подключённые адаптерами к портам, которые объявило ядро. Отсюда симметрия: HTTP-контроллер и Kafka-консьюмер — два адаптера к одному и тому же use case, а PostgreSQL и in-memory реализация в тесте — два адаптера к одному порту хранилища. Практическое следствие — бизнес-правила тестируются без инфраструктуры, а технологию на краю можно поменять, не трогая ядро. Цена — больше интерфейсов и маппинга, и для CRUD это не окупается.</p>
</details>
<details><summary>«Что такое vertical slice architecture? Противоречит ли она clean architecture?»</summary>
<p>Vertical slice — организация кода по фичам: всё, что нужно одному use case, — endpoint, команда, хендлер, валидатор, DTO — лежит рядом, а связанность между срезами минимальна. Каждый срез выбирает свою сложность: простой пишет в <code>DbContext</code> напрямую, сложный работает через доменную модель. Противоречия с clean architecture я не вижу, если понимать их как ответы на разные вопросы: clean architecture про направление зависимостей между ядром и инфраструктурой, слайсы — про организацию прикладного слоя. Доменная модель остаётся общей, а срезы заменяют толстые сервисы вида <code>OrderService</code> с двадцатью методами. Главный риск слайсов — дублирование бизнес-правил между срезами, и его лечат, перенося правила в доменные объекты, а не в общий хелпер.</p>
</details>
<details><summary>«Где должна жить бизнес-логика: в хранимых процедурах или в коде?»</summary>
<p>По умолчанию — в коде приложения: его проще тестировать, версионировать, ревьюить и масштабировать горизонтально, а база — самый трудно масштабируемый компонент. Но я бы не говорил, что процедуры — всегда зло: операции над большими объёмами данных, которые иначе потребовали бы гонять миллионы строк по сети, честнее делать в SQL, и констрейнты, уникальные индексы и exclusion constraints — это тоже правила, которые база гарантирует лучше любого кода. Проблема начинается, когда правила размазаны: часть в процедурах, часть в сервисах, и одно и то же правило записано дважды. На проекте с legacy-базой, где тысячи процедур, переносить всё разом нереально — реалистичный путь: новый код пишется в приложении, а процедуры прячутся за адаптером и выносятся по мере того, как их трогают. Ключевое — у каждого правила одно авторитетное место.</p>
</details>
<details><summary>«Когда вы бы не стали делать многослойную архитектуру?»</summary>
<p>Когда в системе почти нет бизнес-правил: CRUD-справочники, админки, отчётные сервисы, BFF, сервисы-трансляторы, которые читают один топик и пишут в другой. Там слои добавляют только маппинг и интерфейсы с одной реализацией, а путь от запроса до SQL становится длиннее без пользы. Также для прототипа, судьба которого неясна. Ещё я бы не делал одинаковую архитектуру для всей системы: ядро с деньгами и бронированиями заслуживает доменной модели, справочник — простого CRUD, а отчёт — SQL-запроса, и вертикальные срезы как раз позволяют такую неоднородность. Признак, что слоёв слишком много, — цепочка вызовов, где ни один уровень не добавляет логики.</p>
</details>
<details><summary>«Как тестировать приложение с такой архитектурой?»</summary>
<p>Доменную модель — быстрыми юнит-тестами без моков: агрегат — это чистый объект, и тест «нельзя подтвердить заказ без периода» пишется в три строки. Use case-ы я предпочитаю тестировать интеграционно, через публичный вход — команду MediatR или HTTP — с настоящей базой в Testcontainers, подменяя только то, что действительно внешнее: чужие HTTP-API, брокер, время через <code>TimeProvider</code>. Тесты на моках репозиториев хрупкие: они проверяют, какие методы вызывались, и ломаются при любом рефакторинге, не ловя при этом ошибки маппинга и SQL. Отдельный слой — архитектурные тесты на правила зависимостей и контрактные тесты на внешние API. И обязательно хотя бы несколько тестов, проходящих через настоящий HTTP-конвейер: иначе ошибки в контроллерах и сериализации никто не увидит.</p>
</details>
`
    },
    {
      id: 'ddd-tactical',
      title: 'DDD тактический',
      html: `
<h3>Что такое тактический DDD</h3>
<p>Domain-Driven Design описал Эрик Эванс в книге 2003 года («синяя книга»). Позже Вон Вернон в «Implementing Domain-Driven Design» (2013, «красная книга») сделал её практическим руководством. DDD делится на две части:</p>
<ul>
<li><strong>Стратегический DDD</strong> — как разбить большую предметную область на части: bounded contexts, ubiquitous language, context mapping. Это о границах и людях.</li>
<li><strong>Тактический DDD</strong> — строительные блоки модели внутри одного контекста: Entity, Value Object, Aggregate, Domain Service, Domain Event, Repository, Factory.</li>
</ul>
<p>Распространённая ошибка — начинать DDD с тактики: «у нас есть агрегаты и value objects, значит у нас DDD». Сам Эванс подчёркивал, что главная ценность — в стратегической части и в общем языке с экспертами, а тактические паттерны без неё превращаются в церемонию. На собеседовании хорошо это сказать, а затем показать, что тактику вы тоже знаете глубоко.</p>
<p>Тактический DDD оправдан там, где сложная логика и инварианты: заказы, деньги, бронирования, складские остатки. Для справочника «единицы измерения» он не нужен.</p>

<h3>Entity и Value Object</h3>
<p><strong>Entity (сущность)</strong> — объект, определяемый идентичностью, а не атрибутами. Заказ №1042 остаётся тем же заказом, даже если поменялись все его поля. У сущности есть жизненный цикл, она изменяется, равенство — по идентификатору.</p>
<p><strong>Value Object (объект-значение)</strong> — объект, определяемый только значениями атрибутов, без собственной идентичности. Две суммы «100 RUB» взаимозаменяемы. Свойства value object-а:</p>
<ul>
<li><strong>неизменяемость</strong> — изменение означает создание нового значения;</li>
<li><strong>равенство по значению</strong> — сравниваются все компоненты;</li>
<li><strong>самовалидация</strong> — невалидный value object не может существовать;</li>
<li><strong>поведение</strong> — операции, имеющие смысл в домене.</li>
</ul>
<pre><code>public readonly record struct Money
{
    public decimal Amount { get; }
    public string Currency { get; }

    private Money(decimal amount, string currency) =&gt; (Amount, Currency) = (amount, currency);

    public static Result&lt;Money&gt; Create(decimal amount, string currency) =&gt;
        currency is { Length: 3 }
            ? new Money(decimal.Round(amount, 2, MidpointRounding.AwayFromZero), currency)
            : DomainErrors.InvalidCurrency(currency);

    public Money Add(Money other) =&gt; other.Currency == Currency
        ? new Money(Amount + other.Amount, Currency)
        : throw new InvalidOperationException("Нельзя складывать разные валюты");
}</code></pre>
<p>В C# record-ы дают равенство по значению бесплатно. Тонкость: <code>record struct</code> всегда имеет конструктор по умолчанию, и <code>default(Money)</code> — это значение с пустой валютой, обходящее валидацию. Поэтому многие делают value objects как <code>sealed record</code> (класс) либо принимают это ограничение осознанно.</p>
<p>Ключевой эффект value objects — борьба с <strong>primitive obsession</strong>: <code>Sku</code>, <code>AssetTag</code>, <code>Email</code>, <code>OrderId</code> вместо <code>string</code> и <code>Guid</code>. Компилятор перестаёт пропускать перепутанные аргументы, а правило формата живёт в одном месте. Сильно типизированные идентификаторы (<code>readonly record struct OrderId(Guid Value)</code>) — частый вопрос на собеседовании: плюсы в безопасности типов, минусы — конвертеры для EF, JSON и маршрутизации.</p>

<h3>Агрегаты и инварианты</h3>
<p><strong>Aggregate (агрегат)</strong> — кластер связанных сущностей и value objects, который рассматривается как единое целое с точки зрения изменения данных. У агрегата есть <strong>корень</strong> (aggregate root) — единственная сущность, через которую внешний мир взаимодействует с агрегатом. Внешние объекты могут держать ссылку только на корень.</p>
<p>Зачем: агрегат — <strong>граница консистентности</strong>. Всё, что внутри, должно удовлетворять инвариантам в момент завершения любой транзакции. Инвариант — правило, которое должно быть истинным всегда: «сумма строк заказа равна итогу», «в заказе нельзя дважды заказать одну модель», «нельзя выдать больше, чем заказано».</p>
<pre><code>public sealed class Order : AggregateRoot&lt;OrderId&gt;
{
    private readonly List&lt;OrderLine&gt; _lines = [];
    public IReadOnlyList&lt;OrderLine&gt; Lines =&gt; _lines;
    public OrderState State { get; private set; }

    public Result AddLine(ProductId product, int quantity)
    {
        if (State is OrderState.Finished or OrderState.Cancelled)
            return DomainErrors.OrderNotEditable(Id);
        if (_lines.Any(l =&gt; l.ProductId == product))
            return DomainErrors.OrderLineDuplicate(product);
        if (quantity &lt;= 0)
            return DomainErrors.QuantityMustBePositive();

        _lines.Add(new OrderLine(product, quantity));
        Raise(new OrderLineAdded(Id, product, quantity));
        return Result.Success();
    }
}</code></pre>
<p>Обратите внимание: коллекция строк закрыта (<code>IReadOnlyList</code>), состояние меняется только методами с доменными именами, и каждый метод проверяет инвариант до изменения. Код вне агрегата не может написать <code>order.Lines.Add(...)</code> и обойти правило «одна модель — одна строка».</p>
<p>Правило «одна транзакция — один агрегат»: в рамках одной бизнес-транзакции изменяется один агрегат, а согласованность между агрегатами достигается асинхронно (через доменные события). Это рекомендация, а не закон: внутри монолита с одной базой иногда разумно изменить два агрегата в одной транзакции, но это надо делать осознанно.</p>

<h3>Размер и границы агрегата</h3>
<p>Самый частый вопрос по тактическому DDD — «как определить границу агрегата». Вон Вернон в серии статей «Effective Aggregate Design» сформулировал четыре правила:</p>
<ol>
<li><strong>Моделируйте истинные инварианты внутри границы консистентности.</strong> В агрегат входит то, что должно быть согласовано <em>немедленно</em>, транзакционно. Не то, что «связано по смыслу».</li>
<li><strong>Проектируйте маленькие агрегаты.</strong> Большой агрегат медленно загружается, часто конфликтует при конкурентных изменениях (оптимистическая блокировка на весь агрегат) и плохо масштабируется.</li>
<li><strong>Ссылайтесь на другие агрегаты по идентификатору</strong>, а не объектной ссылкой. Строка заказа хранит <code>ProductId</code>, а не <code>Product</code>. Это делает границу явной и не даёт случайно изменить чужой агрегат.</li>
<li><strong>Используйте eventual consistency за пределами границы.</strong> Если правило может выполниться через секунду, оно не требует общего агрегата.</li>
</ol>
<p>Пример рассуждения: должен ли «Заказ» включать «Единицы оборудования», которые на нём забронированы? Инвариант «одна единица не может быть забронирована двумя заказами на пересекающийся период» охватывает <em>много заказов</em>, а не один. Если сделать агрегатом «Заказ», инвариант не проверить внутри него; если сделать агрегатом «Единицу», то заказ на сто единиц трогает сто агрегатов. Реалистичное решение — проверить инвариант там, где его надёжно гарантирует хранилище: exclusion constraint в PostgreSQL или блокировка по продукту. Это хорошая иллюстрация того, что <strong>не каждый инвариант ложится в агрегат</strong>, и честный ответ на собеседовании это признаёт.</p>
<p>Конкурентность: агрегат обычно защищён оптимистической блокировкой — версия (в PostgreSQL удобно <code>xmin</code> через <code>IsRowVersion()</code> в Npgsql, в SQL Server — <code>rowversion</code>). Конфликт → <code>DbUpdateConcurrencyException</code> → повтор команды или ошибка 409.</p>

<h3>Domain Services и Factories</h3>
<p><strong>Domain Service</strong> — операция, которая важна для домена, но естественно не принадлежит ни одной сущности или value object-у. Обычно она оперирует несколькими агрегатами или требует внешних знаний. Признаки:</p>
<ul>
<li>операция названа глаголом из языка домена («рассчитать доступность», «перевести деньги»);</li>
<li>её интерфейс выражен доменными типами;</li>
<li>она без состояния (stateless).</li>
</ul>
<pre><code>public sealed class AvailabilityCalculator
{
    public int FreeQuantity(IReadOnlyList&lt;Unit&gt; units, IReadOnlyList&lt;Reservation&gt; holds, Period period) =&gt;
        units.Count(u =&gt; u.IsBookable) - holds.Where(h =&gt; h.Period.Overlaps(period)).MaxConcurrent();
}</code></pre>
<p>Не путать с <strong>Application Service</strong> (хендлером use case): тот координирует — загружает агрегаты, вызывает доменные методы, сохраняет, публикует события, — но бизнес-правил не содержит. Если в хендлере появляются <code>if</code> с бизнес-смыслом, это сигнал, что логика утекает из домена. Злоупотребление доменными сервисами — прямой путь к анемичной модели: всё поведение уходит в «сервисы», а сущности остаются структурами.</p>
<p><strong>Factory</strong> (у Эванса) — инкапсулирует создание сложного агрегата, когда конструктор не справляется: нужно собрать несколько объектов, проверить инварианты целого, получить данные из нескольких источников. Формы: статический фабричный метод на корне (<code>Order.Create(...)</code> возвращающий <code>Result&lt;Order&gt;</code>), метод на другом агрегате (<code>template.InstantiateOrder(...)</code>), отдельный класс-фабрика, если нужны зависимости. Фабрика создаёт объект в валидном состоянии целиком — «невалидный объект не должен существовать даже на мгновение».</p>

<h3>Domain Events</h3>
<p><strong>Доменное событие</strong> — факт, произошедший в домене и важный для экспертов, сформулированный в прошедшем времени: <code>OrderConfirmed</code>, <code>UnitCheckedOut</code>, <code>PaymentReceived</code>. В оригинальной книге Эванса их не было как отдельного блока; они были добавлены позже и подробно описаны Верноном.</p>
<p>Зачем: связать агрегаты без прямых зависимостей (подтверждение заказа → создание брони, уведомление ответственному), отделить побочные эффекты от основной операции, дать точку интеграции для других контекстов.</p>
<p>Типичная реализация: агрегат накапливает события в списке, а инфраструктура их забирает при сохранении:</p>
<pre><code>public abstract class AggregateRoot&lt;TId&gt;
{
    private readonly List&lt;IDomainEvent&gt; _events = [];
    public IReadOnlyList&lt;IDomainEvent&gt; DomainEvents =&gt; _events;
    protected void Raise(IDomainEvent e) =&gt; _events.Add(e);
    public void ClearEvents() =&gt; _events.Clear();
}</code></pre>
<p>Ключевой вопрос — <strong>когда</strong> обработать события:</p>
<ul>
<li><strong>До коммита, в той же транзакции</strong> (например, в <code>SaveChangesInterceptor</code> или перед <code>SaveChanges</code>) — побочные изменения в базе атомарны с основной операцией. Подходит для изменений других агрегатов в той же базе.</li>
<li><strong>После коммита</strong> — для внешних эффектов (письмо, Kafka). Но если процесс упадёт между коммитом и публикацией, событие потеряется. Поэтому для интеграции используют <strong>Transactional Outbox</strong>: событие записывается в таблицу outbox в той же транзакции, а отдельный процесс публикует его в брокер с гарантией at-least-once.</li>
</ul>
<p>Различайте <strong>доменные события</strong> (внутри контекста, могут содержать доменные типы, меняются вместе с моделью) и <strong>интеграционные события</strong> (публичный контракт для других сервисов, стабильный, версионируемый, без внутренних деталей). Публиковать доменные события в Kafka как есть — значит сделать внутреннюю модель публичным API.</p>

<h3>Rich vs anemic model и persistence ignorance</h3>
<p>Мартин Фаулер в 2003 году назвал <strong>Anemic Domain Model</strong> анти-паттерном: объекты с геттерами и сеттерами без поведения, а вся логика — в сервисах. Это процедурный стиль в ООП-обёртке: инварианты не защищены (любой может присвоить <code>order.State = Finished</code>), правила дублируются по сервисам.</p>
<pre><code>// Анемичная модель
order.State = OrderState.Confirmed;
order.ConfirmedAt = DateTime.UtcNow;   // кто-то забудет эту строку

// Богатая модель
var result = order.Confirm(clock.GetCurrentInstant());   // правило и побочные поля в одном месте</code></pre>
<p>Честная оговорка: анемичная модель не всегда ошибка. Для CRUD, где «правило» — это валидация полей, она проще и достаточна. Богатая модель окупается при сложных переходах состояний и инвариантах.</p>
<p><strong>Persistence ignorance</strong> — доменная модель не знает о том, как она хранится. С EF Core полная изоляция достижима, но с компромиссами:</p>
<ul>
<li>EF нужен конструктор без параметров (может быть приватным) или конструктор, параметры которого совпадают со свойствами;</li>
<li>навигационные коллекции приходится оставлять как <code>List</code> в приватном поле и маппить через backing field;</li>
<li>value objects — owned types или complex types, у каждого свои ограничения (у owned types в EF Core есть скрытый ключ, complex types изначально не поддерживали nullable и коллекции);</li>
<li>ленивая загрузка ломает модель — агрегат должен загружаться целиком, поэтому её лучше не включать.</li>
</ul>
<p>Реалистичная позиция: доменные классы без атрибутов EF и без ссылок на него, маппинг полностью в Fluent API в инфраструктуре, а мелкие уступки (приватный конструктор, поле <code>_lines</code>) принимаются. Альтернатива — отдельные persistence-модели и маппинг домен ↔ таблицы — даёт полную чистоту ценой двойного набора классов и ручного отслеживания изменений, и редко окупается.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Чем Entity отличается от Value Object? Приведите примеры из своего домена»</summary>
<p>Entity определяется идентичностью и имеет жизненный цикл: единица оборудования с инвентарным номером остаётся той же, даже если её переместили, починили и переименовали модель. Value Object определяется только значением и неизменяем: сумма денег, период аренды, адрес, асет-тег как строка с правилами формата — два одинаковых значения взаимозаменяемы, и сравнение идёт по всем полям. Практические следствия: value object проверяет свою валидность при создании, поэтому невалидного периода, где конец раньше начала, просто не существует, и правило записано в одном месте. Он убирает primitive obsession — компилятор не даст передать <code>ProductId</code> вместо <code>OrderId</code>. Один и тот же концепт может быть сущностью в одном контексте и значением в другом: адрес в службе доставки, где его уточняют и отслеживают, может быть сущностью, а в заказе — значением.</p>
</details>
<details><summary>«Как вы определяете границы агрегата?»</summary>
<p>Отталкиваюсь от инвариантов, а не от связей на ER-диаграмме: в агрегат входит то, что должно быть согласовано немедленно, в одной транзакции. Дальше — правила Вернона: агрегаты маленькие, ссылаются друг на друга по идентификатору, а согласованность между ними — eventual, через события. Проверочные вопросы: если два пользователя одновременно меняют разные части агрегата, нужно ли, чтобы один получил конфликт? Если нет, это, скорее всего, два агрегата. Сколько данных загружается ради одной операции? Если тысяча строк ради изменения одного поля, агрегат слишком большой. И важно признать, что не каждый инвариант ложится в агрегат: правило «одна единица не забронирована двумя заказами на один период» охватывает много заказов, и его надёжнее гарантирует база — exclusion constraint или блокировка, — чем попытка сделать гигантский агрегат.</p>
</details>
<details><summary>«Что такое анемичная модель и всегда ли она плоха?»</summary>
<p>Анемичная модель — сущности как мешки свойств с публичными сеттерами, а вся логика в сервисах; Фаулер назвал её анти-паттерном, потому что это процедурный код, где инварианты никто не защищает и любое место может перевести заказ в завершённый, забыв проставить дату и освободить брони. Богатая модель прячет состояние за методами с доменными именами — <code>Confirm</code>, <code>CheckOut</code>, <code>Cancel</code> — и каждый метод сам проверяет правила. Но анемичная модель не всегда ошибка: для CRUD-справочника, где правил нет, богатая модель — лишняя церемония. Я выбираю по количеству инвариантов и переходов состояний. Ещё признак, что анемия вредит: одно и то же правило проверяется в нескольких хендлерах или в контроллере и в сервисе одновременно.</p>
</details>
<details><summary>«Как публиковать доменные события надёжно?»</summary>
<p>Агрегат накапливает события в списке во время выполнения методов, а инфраструктура забирает их при сохранении. Для изменений внутри той же базы я обрабатываю их до коммита, в той же транзакции, — тогда побочные эффекты атомарны с операцией. Для внешнего мира — Kafka, письма, другие сервисы — использую Transactional Outbox: событие сериализуется в таблицу outbox в той же транзакции, что и изменение агрегата, а фоновый процесс читает таблицу и публикует в брокер, помечая отправленное. Это даёт at-least-once, поэтому потребители должны быть идемпотентными — по идентификатору события или по естественному ключу. Публикация после коммита без outbox теряет события при падении процесса, а публикация до коммита рассылает события об операциях, которые потом откатились. И я разделяю доменные события и интеграционные: наружу уходит стабильный, версионируемый контракт, а не внутренняя модель.</p>
</details>
<details><summary>«Чем доменный сервис отличается от прикладного?»</summary>
<p>Прикладной сервис — по сути хендлер use case — координирует: загружает агрегаты через репозитории, вызывает их методы, сохраняет, публикует события, управляет транзакцией и авторизацией. Бизнес-правил в нём быть не должно. Доменный сервис содержит бизнес-логику, которая не принадлежит естественно одной сущности, например расчёт доступности по множеству единиц и броней или перевод денег между двумя счетами; он оперирует доменными типами и обычно не имеет состояния. Если в хендлере появляются условия с бизнес-смыслом, логика утекает из домена, и её стоит перенести в агрегат или в доменный сервис. Но и злоупотреблять доменными сервисами нельзя: если всё поведение в них, модель снова анемична.</p>
</details>
<details><summary>«Насколько ваша доменная модель независима от EF Core?»</summary>
<p>Доменный проект не ссылается на EF Core: никаких атрибутов, весь маппинг в <code>IEntityTypeConfiguration</code> в инфраструктуре. Состояние защищено приватными сеттерами, коллекции — приватными полями, наружу торчит <code>IReadOnlyList</code>, и EF работает через backing fields. Value objects маппятся через owned или complex types, а однополевые вроде идентификаторов — через <code>HasConversion</code>. Уступки, которые я принимаю осознанно: приватный конструктор без параметров для материализации и отсутствие ленивой загрузки — агрегат всегда загружается целиком. Отдельные persistence-модели с ручным маппингом дали бы полную изоляцию, но удваивают классы и лишают change tracking, поэтому редко окупаются. Тестирую маппинг интеграционными тестами на настоящем PostgreSQL.</p>
</details>
<details><summary>«Что такое инвариант и где его проверять?»</summary>
<p>Инвариант — условие, которое должно быть истинным всегда, а не только при вводе данных: итог заказа равен сумме строк, выдано не больше заказанного, конец периода не раньше начала. Инварианты одного объекта проверяет value object при создании, инварианты агрегата — его корень в каждом методе, меняющем состояние, до изменения. Инварианты, охватывающие много агрегатов или требующие уникальности, надёжно гарантирует только база: уникальный индекс, foreign key, exclusion constraint — а код при этом проверяет их заранее, чтобы вернуть понятную ошибку, а не исключение из драйвера. Валидация входных данных — формат, обязательность — это отдельный слой на границе, и он не заменяет инварианты: команда может прийти из Kafka в обход контроллера. Хорошее правило: невалидный объект не должен существовать даже на мгновение.</p>
</details>
`
    },
    {
      id: 'ddd-strategic',
      title: 'DDD стратегический',
      html: `
<h3>Зачем стратегический DDD</h3>
<p>Тактический DDD отвечает на вопрос «как устроить модель», стратегический — «<strong>сколько моделей должно быть и где их границы</strong>». Главная мысль Эванса: в большой системе единая модель для всего невозможна и вредна. Слово «товар» на складе означает физическую вещь с местом хранения и весом, в каталоге — карточку с описанием и фотографиями, в биллинге — позицию с ценой и ставкой налога. Попытка сделать один класс <code>Product</code> на всех даёт объект с сотней полей, которые меняются по разным причинам и разными командами, — Big Ball of Mud.</p>
<p>Стратегический DDD даёт инструменты:</p>
<ul>
<li><strong>Ubiquitous Language</strong> — общий язык команды и экспертов внутри границы;</li>
<li><strong>Bounded Context</strong> — граница, внутри которой модель и язык однозначны;</li>
<li><strong>Context Map</strong> — карта отношений между контекстами и командами;</li>
<li><strong>Subdomains</strong> — классификация частей бизнеса по ценности: core, supporting, generic.</li>
</ul>
<p>Эти вещи важнее для архитектуры, чем агрегаты: ошибка в границе агрегата исправляется рефакторингом за день, ошибка в границе контекстов (особенно если по ней нарезаны микросервисы и команды) стоит месяцы.</p>

<h3>Ubiquitous Language</h3>
<p><strong>Единый язык</strong> — язык, который используют и эксперты предметной области, и разработчики, и который напрямую отражён в коде: в именах классов, методов, событий, таблиц. Если кладовщик говорит «отбор» и «ячейка», а в коде <code>PickTask</code> и <code>StorageSlot</code> — это ещё ок, если словарь зафиксирован. Если же в разговоре «отгрузка», а в коде <code>Delivery</code>, в базе <code>shipment</code>, а в API <code>dispatch</code>, — каждый перевод между ними источник ошибок.</p>
<p>Практика:</p>
<ul>
<li><strong>Глоссарий</strong> терминов с определениями и примерами, живущий рядом с кодом (в README репозитория или в документации контекста);</li>
<li>в коде — методы с доменными именами: <code>order.Confirm()</code>, а не <code>order.SetStatus(2)</code>; <code>unit.Decommission()</code>, а не <code>unit.IsActive = false</code>;</li>
<li>язык меняется вместе с пониманием: если эксперты начали различать «бронь» и «резерв», в модели появляются два понятия;</li>
<li>неоднозначность — сигнал границы: если одно слово значит разное для двух групп людей, это, вероятно, два контекста.</li>
</ul>
<p>Язык единый <strong>внутри bounded context</strong>, а не на всю компанию. Это самая частая ошибка понимания: «давайте договоримся, что значит "заказ" для всей компании» — невозможная задача. Правильно: «в контексте склада заказ означает X, в контексте продаж — Y, и вот как они соотносятся».</p>
<p>Для мультиязычной команды полезный приём: термины предметной области фиксируются на языке экспертов (русском) с однозначным английским именем для кода, и это соответствие — часть глоссария.</p>

<h3>Bounded Context</h3>
<p><strong>Bounded Context (ограниченный контекст)</strong> — явная граница, внутри которой конкретная модель определена и применима, а термины имеют одно значение. Это одновременно граница:</p>
<ul>
<li><strong>лингвистическая</strong> — где действует единый язык;</li>
<li><strong>модельная</strong> — где действует одна модель;</li>
<li><strong>организационная</strong> — обычно одна команда владеет контекстом;</li>
<li><strong>техническая</strong> — отдельный модуль, схема БД, сервис.</li>
</ul>
<p>Пример для складской логистики:</p>
<table>
<thead><tr><th>Контекст</th><th>Что значит «товар»</th><th>Ключевые понятия</th></tr></thead>
<tbody>
<tr><td>Приёмка</td><td>Ожидаемая поставка от поставщика</td><td>Поставка, расхождение, акт</td></tr>
<tr><td>Хранение</td><td>Физический остаток в ячейке</td><td>Ячейка, остаток, перемещение</td></tr>
<tr><td>Отбор и отгрузка</td><td>Позиция в задании сборщика</td><td>Задание, маршрут, тара</td></tr>
<tr><td>Биллинг</td><td>Услуга хранения с тарифом</td><td>Тариф, начисление, период</td></tr>
</tbody>
</table>
<p>Один и тот же SKU связывает их, но у каждого контекста своя модель с нужными ему полями. Связь — через идентификатор и через события/контракты, а не через общую таблицу.</p>
<p>Bounded context ≠ микросервис. Контекст — логическая граница; его можно реализовать как модуль в модульном монолите, как один сервис, а иногда — как несколько сервисов (по причинам масштабирования). Но правило в обратную сторону строже: <strong>один микросервис не должен содержать кусков нескольких контекстов</strong>, и несколько сервисов не должны делить одну модель через общую базу.</p>

<h3>Subdomains: core, supporting, generic</h3>
<p><strong>Subdomain (поддомен)</strong> — часть предметной области бизнеса, в отличие от bounded context, который — часть решения. Классификация по ценности:</p>
<ul>
<li><strong>Core domain</strong> — то, чем компания отличается от конкурентов и на чём зарабатывает. Здесь сложная логика, здесь лучшие разработчики, богатая модель, DDD в полную силу. Для арендной компании — бронирование и доступность оборудования; для маркетплейса — ценообразование и логистика.</li>
<li><strong>Supporting subdomain</strong> — нужно бизнесу, специфично для него, но не даёт конкурентного преимущества. Пишется своими силами, но проще: CRUD, транзакционный сценарий. Пример — учёт контрагентов, справочник категорий.</li>
<li><strong>Generic subdomain</strong> — типовая задача, одинаковая для всех: аутентификация, платежи, отправка писем, бухгалтерия. Покупается или берётся готовым: Keycloak, платёжный шлюз, 1С.</li>
</ul>
<p>Практическое значение классификации — <strong>куда вкладывать</strong>. Писать свою систему авторизации — тратить лучшие силы на generic. Покупать «коробку» для core — отдать отличие от конкурентов вендору. Классификация меняется со временем: то, что было core, может стать commodity.</p>
<blockquote><strong>Важно.</strong> Subdomain — пространство проблемы (что есть в бизнесе), bounded context — пространство решения (как мы это разделили в софте). В идеале они совпадают один к одному, но бывает, что один контекст покрывает несколько поддоменов (legacy-монолит) или один поддомен разбит на несколько контекстов.</blockquote>

<h3>Context Mapping: отношения между контекстами</h3>
<p><strong>Context Map</strong> — карта контекстов и отношений между ними. Отношения отражают не только технические интеграции, но и <strong>власть между командами</strong>: кто под кого подстраивается. Паттерны из книги Эванса и DDD Reference:</p>
<ul>
<li><strong>Partnership</strong> — две команды зависят друг от друга, планируют и релизят совместно, успех общий.</li>
<li><strong>Shared Kernel</strong> — две команды договорились о небольшой общей части модели (общая библиотека или схема), которую меняют только совместно. Дёшево вначале, но создаёт сильную связанность; держать минимальным.</li>
<li><strong>Customer/Supplier</strong> — upstream (поставщик) и downstream (потребитель); потребитель влияет на приоритеты поставщика, требования согласуются, поставщик учитывает потребности в планировании.</li>
<li><strong>Conformist</strong> — downstream принимает модель upstream как есть, без перевода, потому что повлиять не может (большой вендор, другая организация). Просто, но чужая модель проникает в ваш код.</li>
<li><strong>Anticorruption Layer (ACL)</strong> — downstream строит слой перевода, изолирующий свою модель от модели upstream. Защищает от «порчи» своей модели чужими понятиями.</li>
<li><strong>Open Host Service (OHS)</strong> — upstream предоставляет хорошо определённый протокол/API для многих потребителей вместо индивидуальных интеграций.</li>
<li><strong>Published Language</strong> — документированный общий язык обмена (схема событий, стандарт формата — Avro/Protobuf-схемы в Schema Registry, отраслевой стандарт), часто вместе с OHS.</li>
<li><strong>Separate Ways</strong> — интеграция не стоит усилий, контексты решают задачи независимо (даже ценой дублирования).</li>
</ul>
<p>Ещё одно обозначение — <strong>Big Ball of Mud</strong>: часть системы без чётких границ, которую стоит обвести и изолировать (обычно через ACL).</p>

<h3>Anti-Corruption Layer на практике</h3>
<p>ACL — самый практичный паттерн context mapping и частый вопрос на собеседовании, особенно если в резюме есть legacy. Задача: новый контекст работает со старой системой (legacy-база с тысячами процедур, внешний API, монолит), но не хочет впускать её модель в свою.</p>
<pre><code>// Наш порт, на нашем языке
public interface ISupplierCatalog
{
    Task&lt;SupplierItem?&gt; FindAsync(Sku sku, CancellationToken ct);
}

// ACL: перевод из модели legacy в нашу
internal sealed class LegacyCatalogAdapter(SqlConnection legacyDb) : ISupplierCatalog
{
    public async Task&lt;SupplierItem?&gt; FindAsync(Sku sku, CancellationToken ct)
    {
        var row = await legacyDb.QuerySingleOrDefaultAsync&lt;LegacyGoodsRow&gt;(
            "dbo.sp_Goods_GetByArticle", new { Article = sku.Value, Mode = 3 },
            commandType: CommandType.StoredProcedure);

        if (row is null || row.DelFlag == 1) return null;          // смысл флага знает только ACL
        return new SupplierItem(
            sku,
            Weight.FromGrams(row.Wt_g),                             // единицы — наши
            row.StatusCode switch { 1 or 7 =&gt; ItemStatus.Active, _ =&gt; ItemStatus.Blocked });
    }
}</code></pre>
<p>В ACL живут: перевод форматов и единиц, интерпретация магических кодов и флагов, композиция нескольких вызовов в одно понятие, защита от странного поведения (ретраи, таймауты, кэш). Остальной код видит чистый <code>SupplierItem</code>. Когда legacy заменят, переписывается только ACL.</p>
<p>ACL может быть классом внутри сервиса (адаптер), а может — отдельным сервисом-транслятором, который читает изменения legacy (например, через CDC — Debezium) и публикует нормальные события в Kafka. Второй вариант — типичный инструмент strangler fig при распиле монолита.</p>

<h3>Как резать микросервисы по контекстам</h3>
<p>Распространённая рекомендация: граница микросервиса не шире bounded context. Почему именно контекст, а не сущность или техническая функция:</p>
<ul>
<li><strong>Сервис на сущность</strong> («сервис товаров», «сервис заказов», «сервис клиентов») — анти-паттерн entity services: любой бизнес-сценарий требует синхронных вызовов в несколько сервисов, транзакции становятся распределёнными, получается распределённый монолит.</li>
<li><strong>Сервис на техническую функцию</strong> («сервис валидации», «сервис уведомлений для всего») — та же проблема, логика сценария размазана.</li>
<li><strong>Сервис на контекст</strong> — высокая связность внутри (весь язык и правила рядом), слабая связанность снаружи (общение событиями и узким API), и совпадает с границей команды.</li>
</ul>
<p>Инструменты поиска границ:</p>
<ul>
<li><strong>Event Storming</strong> (Альберто Брандолини) — воркшоп с экспертами, где на стене выкладываются доменные события в хронологическом порядке, затем команды, акторы, политики, агрегаты. Места, где меняется язык или ответственные люди, — кандидаты на границы.</li>
<li><strong>Анализ языка</strong> — одно слово с разными значениями означает границу.</li>
<li><strong>Анализ изменений</strong> — что меняется вместе, должно быть вместе.</li>
<li><strong>Требования к консистентности</strong> — если две вещи должны быть согласованы транзакционно, разрезать их между сервисами дорого.</li>
<li><strong>Структура команд</strong> — закон Конвея: границы систем повторяют коммуникацию команд.</li>
</ul>
<p>Совет, который хорошо звучит на собеседовании: если границы неясны, начинать с модульного монолита, где границы контекстов — модули, а выносить в сервис, когда граница проверена временем и есть причина (независимое масштабирование, отдельная команда, другой темп релизов).</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Что такое bounded context и чем он отличается от микросервиса?»</summary>
<p>Bounded context — явная граница, внутри которой одна модель и один язык: слово «товар» внутри контекста хранения означает физический остаток в ячейке и ничего больше. Это граница прежде всего смысловая и организационная, обычно ей владеет одна команда. Микросервис — единица развёртывания, техническое решение. Контекст можно реализовать как модуль модульного монолита, как один сервис или, реже, как несколько сервисов, если, например, приёмку данных надо масштабировать отдельно от остального. Обратное правило строже: один сервис не должен смешивать модели разных контекстов, и разные контексты не должны делить одну модель через общую базу данных. Поэтому контекст — хороший верхний предел размера сервиса.</p>
</details>
<details><summary>«Что такое Anti-Corruption Layer и когда он нужен?»</summary>
<p>ACL — слой перевода между нашей моделью и моделью чужой системы, которая нам неудобна или на которую мы не можем повлиять: legacy-база, внешний вендор, старый монолит. Наш код работает с портом на своём языке, а ACL реализует его: вызывает чужой API или процедуру, переводит единицы и форматы, интерпретирует магические коды и флаги, собирает понятие из нескольких вызовов и защищает от нестабильности ретраями и таймаутами. Нужен он, когда модель upstream отличается от нашей, а альтернатива — Conformist, то есть принять чужую модель как есть, — допускает её понятия по всему коду. В работе с большой legacy-базой с тысячами процедур это единственный способ не превратить новый сервис в продолжение старого. ACL может быть классом-адаптером или отдельным сервисом, который читает изменения через CDC и публикует нормальные события.</p>
</details>
<details><summary>«Назовите паттерны context mapping и как они связаны с отношениями команд»</summary>
<p>Context map показывает не только интеграции, но и распределение влияния между командами. Partnership — команды зависят друг от друга и планируют совместно. Shared Kernel — небольшая общая часть модели, меняемая только по согласию обеих сторон, — дёшево, но связывает релизы. Customer/Supplier — upstream учитывает потребности downstream в своём планировании. Conformist — downstream не может повлиять и принимает модель как есть. Anticorruption Layer — downstream защищает свою модель переводом. Open Host Service и Published Language — upstream публикует стабильный протокол и документированную схему для многих потребителей, например события со схемами в Schema Registry. Separate Ways — интеграция не стоит усилий. Выбор паттерна во многом определяется тем, можете ли вы договориться с командой на той стороне.</p>
</details>
<details><summary>«Что такое core, supporting и generic subdomain? Как это влияет на решения?»</summary>
<p>Core domain — то, чем компания отличается от конкурентов и на чём зарабатывает; supporting — специфичное для бизнеса, но не дающее преимущества; generic — типовые задачи, одинаковые у всех. Классификация отвечает на вопрос, куда вкладывать силы. В core — лучшие люди, богатая доменная модель, тщательное проектирование и тесты. В supporting — простые решения, CRUD, без тяжёлой артиллерии. Generic — покупать или брать готовым: аутентификацию отдать Keycloak, бухгалтерию — 1С, платежи — шлюзу. Типичные ошибки — писать собственную систему авторизации, тратя лучшие силы на commodity, или пытаться купить коробочное решение для того, что и есть ваше конкурентное преимущество. Ещё важно, что поддомен — это пространство проблемы, а контекст — решения, и они не обязаны совпадать.</p>
</details>
<details><summary>«Как вы находите границы контекстов в существующей системе?»</summary>
<p>Начинаю с языка: где одно слово значит разное для разных людей или где одни и те же данные используются с разными правилами, там проходит граница. Дальше смотрю на изменения: какие части кода и таблиц меняются вместе в одних задачах, а какие независимо, — история git и тикетов честнее любых диаграмм. Третий источник — требования к консистентности: то, что должно быть согласовано в одной транзакции, разрезать дорого. Четвёртый — структура команд и ответственных людей на стороне бизнеса. С экспертами хорошо работает Event Storming: выкладываем доменные события по времени и видим, где меняются акторы и язык. И я бы проверил границы в модульном монолите, прежде чем резать на сервисы, потому что ошибочную границу между модулями исправить в разы дешевле, чем между сервисами с отдельными базами.</p>
</details>
<details><summary>«Почему "сервис на каждую сущность" — плохая идея?»</summary>
<p>Потому что бизнес-сценарии почти никогда не укладываются в одну сущность: оформление заказа трогает товары, остатки, клиента и цены, и если это четыре сервиса, один сценарий превращается в цепочку синхронных вызовов. Отсюда сложение задержек и вероятностей отказа, распределённые транзакции и саги там, где хватило бы одной транзакции, и необходимость релизить несколько сервисов вместе для любой фичи — то есть распределённый монолит. Логика сценария при этом не принадлежит никому, она размазана по оркестратору. Сервис на bounded context держит весь язык и правила сценария вместе, а наружу общается событиями и узким API. Признак неудачного разреза — сервис, который почти ничего не делает без синхронного вызова соседа.</p>
</details>
<details><summary>«Shared Kernel или дублирование моделей между сервисами?»</summary>
<p>Общая библиотека моделей между сервисами — это Shared Kernel, и он требует, чтобы обе команды меняли его только по согласию, иначе обновление пакета ломает соседей или заставляет релизиться синхронно. Поэтому я держу Shared Kernel минимальным: идентификаторы, базовые value objects вроде денег, контракты событий. Доменные модели между контекстами лучше дублировать: у каждого контекста свой «товар» с нужными ему полями, и это не нарушение DRY, потому что знания разные. Контракты интеграции лучше описывать схемой — Protobuf, Avro, JSON Schema — с правилами совместимости, а не общим C#-классом, тогда потребители на любом языке генерируют свой код. Внутренние SDK оправданы для инфраструктурных вещей — клиент брокера, трассировка, авторизация, — но не для бизнес-моделей.</p>
</details>
`
    },
    {
      id: 'cqrs',
      title: 'CQRS и Event Sourcing',
      html: `
<h3>От CQS к CQRS</h3>
<p><strong>CQS (Command-Query Separation)</strong> — принцип Бертрана Мейера на уровне методов: метод либо меняет состояние (команда) и ничего не возвращает, либо возвращает данные (запрос) и не имеет побочных эффектов. «Задать вопрос не должно менять ответ».</p>
<p><strong>CQRS (Command Query Responsibility Segregation)</strong> — идея, которую около 2010 года популяризировал Грег Янг: применить то же разделение на уровне <em>архитектуры</em>. Модель для изменения данных (write model) и модель для чтения (read model) — разные модели. Мотивация:</p>
<ul>
<li>требования к записи и чтению различаются: запись защищает инварианты и работает с одним агрегатом, чтение собирает данные из многих мест в форму, удобную экрану;</li>
<li>одна модель, пытающаяся служить обеим целям, обрастает навигационными свойствами, <code>Include</code>-ами и DTO-маппингом, а агрегат становится тяжёлым ради экранов;</li>
<li>нагрузка на чтение обычно в разы больше, и её хочется оптимизировать отдельно.</li>
</ul>
<p>Важно понять, что <strong>CQRS не требует отдельных баз данных</strong>, брокера, event sourcing и eventual consistency. Самая простая и самая частая форма — одна база, одна транзакция, но разный код: команды загружают агрегат через репозиторий и сохраняют, запросы делают проекцию прямо в DTO, минуя доменную модель.</p>
<pre><code>// Write side: агрегат, инварианты
public sealed class ConfirmOrderHandler(IOrderRepository orders, IUnitOfWork uow)
    : IRequestHandler&lt;ConfirmOrder, Result&gt;
{
    public async Task&lt;Result&gt; Handle(ConfirmOrder cmd, CancellationToken ct)
    {
        var order = await orders.GetAsync(cmd.OrderId, ct);
        if (order is null) return Errors.OrderNotFound(cmd.OrderId);
        var result = order.Confirm(cmd.AcknowledgeShortage);
        if (result.IsSuccess) await uow.SaveChangesAsync(ct);
        return result;
    }
}

// Read side: прямая проекция, без агрегата и без трекинга
public sealed class GetOrderListHandler(AppDbContext db)
    : IRequestHandler&lt;GetOrderList, Page&lt;OrderRow&gt;&gt;
{
    public async Task&lt;Page&lt;OrderRow&gt;&gt; Handle(GetOrderList q, CancellationToken ct) =&gt;
        await db.Orders.AsNoTracking()
            .Where(o =&gt; o.State == OrderState.Confirmed)
            .OrderBy(o =&gt; o.StartsAt)
            .Select(o =&gt; new OrderRow(o.Id, o.Number, o.Title, o.Counterparty.Name, o.Lines.Count))
            .ToPageAsync(q.Page, ct);
}</code></pre>
<p>Уровни CQRS по нарастанию сложности: (1) разный код для чтения и записи над одной схемой; (2) отдельные read-таблицы или материализованные представления в той же базе, обновляемые синхронно или триггерами; (3) отдельное хранилище для чтения (Elasticsearch, Redis, реплика), обновляемое асинхронно по событиям; (4) event sourcing на стороне записи. Переходить на следующий уровень стоит только при реальной причине.</p>

<h3>MediatR и pipeline behaviors</h3>
<p>MediatR (Джимми Богард) — in-process реализация паттерна Mediator: отправитель вызывает <code>mediator.Send(request)</code>, а библиотека находит единственный <code>IRequestHandler</code>. Для уведомлений (<code>INotification</code>) — рассылка всем обработчикам. Поверх этого — <code>IPipelineBehavior</code>, цепочка обёрток вокруг хендлера.</p>
<p><strong>Что даёт:</strong></p>
<ul>
<li>один класс на use case — естественный SRP и навигация «одна фича — один файл»;</li>
<li>контроллеры становятся тонкими: принять запрос, отправить, отобразить результат;</li>
<li>сквозная функциональность (валидация, логирование, транзакции, авторизация, метрики, кэш) в behaviors — пишется один раз и не забывается в новом хендлере;</li>
<li>один и тот же use case вызывается из HTTP, из консьюмера Kafka и из теста одинаково.</li>
</ul>
<p><strong>Критика, которую стоит знать:</strong></p>
<ul>
<li>это непрямой вызов: «Go to Definition» на <code>Send</code> ведёт в библиотеку, а не в хендлер; отладка идёт через слои дженериков;</li>
<li>то же самое достигается прямым внедрением хендлера (<code>ConfirmOrderHandler</code> в конструктор) и декораторами через Scrutor — без рефлексии и с проверкой на этапе компиляции;</li>
<li>соблазн вызывать <code>Send</code> из хендлера (хендлер в хендлере) создаёт скрытые зависимости и неочевидные транзакционные границы;</li>
<li>behaviors, которые ветвятся по типу запроса или ответа, — хрупкая магия: новый тип ответа может тихо не попасть под нужную обработку;</li>
<li>с 2025 года MediatR распространяется под коммерческой лицензией для компаний выше определённого размера, поэтому в новых проектах часто выбирают альтернативы: source-generated <code>Mediator</code> (Martin Othamar), Wolverine или просто ручные хендлеры с декораторами.</li>
</ul>
<blockquote><strong>Важно.</strong> «MediatR — это не CQRS». MediatR — механизм диспетчеризации запросов в процессе. CQRS — разделение моделей чтения и записи. Можно делать CQRS без MediatR (два набора сервисов) и использовать MediatR без CQRS (команды и запросы работают с одной и той же моделью через одни и те же репозитории). Интервьюеры любят ловить на этом смешении.</blockquote>

<h3>Read models и проекции</h3>
<p><strong>Read model (модель чтения)</strong> — данные, подготовленные под конкретный сценарий чтения: денормализованные, с заранее посчитанными агрегатами, в форме экрана или API. <strong>Проекция</strong> — код, который строит read model из источника истины: из таблиц write-модели, из событий или из потока изменений (CDC).</p>
<p>Варианты реализации:</p>
<ul>
<li><strong>Проекция в запросе</strong> — LINQ <code>Select</code> в DTO или SQL-view. Всегда консистентно, ничего не хранится, цена — вычисление на каждом чтении.</li>
<li><strong>Материализованная таблица, обновляемая в той же транзакции</strong> — например, счётчик остатков, который пересчитывается при каждом движении. Консистентно, но запись становится дороже, и логика обновления должна быть в каждом месте изменения (лучше — в одном перехватчике).</li>
<li><strong>Асинхронная проекция по событиям</strong> — консьюмер читает события (из outbox, Kafka или event store) и обновляет read-хранилище. Масштабируется и разгружает основную базу, но read model отстаёт от записи (eventual consistency).</li>
</ul>
<p>Свойства хорошей асинхронной проекции:</p>
<ul>
<li><strong>идемпотентность</strong> — повторная обработка того же события не меняет результат (хранить позицию/версию последнего обработанного события, upsert-ы вместо инкрементов);</li>
<li><strong>упорядоченность в пределах ключа</strong> — события одного агрегата обрабатываются по порядку (в Kafka — один ключ партиционирования на агрегат);</li>
<li><strong>перестраиваемость</strong> — read model можно удалить и построить заново из источника; это главное отличие от «ещё одной копии данных»;</li>
<li><strong>отслеживаемое отставание</strong> — метрика lag и алерт на неё.</li>
</ul>
<p>Read model — не второй источник истины. Если её нельзя перестроить, это уже не проекция, а дубликат, который рано или поздно разойдётся с оригиналом.</p>

<h3>Event Sourcing: механика</h3>
<p><strong>Event Sourcing</strong> — способ хранения состояния: вместо текущего состояния агрегата хранится <strong>последовательность событий</strong>, которые к нему привели. Текущее состояние получается применением (fold) всех событий по порядку. Событие — неизменяемый факт: <code>OrderCreated</code>, <code>LineAdded</code>, <code>OrderConfirmed</code>. Лог только дописывается (append-only).</p>
<pre><code>public sealed class Order
{
    public OrderId Id { get; private set; }
    public OrderState State { get; private set; }
    public int Version { get; private set; }
    private readonly List&lt;IEvent&gt; _pending = [];

    public static Order Rehydrate(IEnumerable&lt;IEvent&gt; history)
    {
        var order = new Order();
        foreach (var e in history) order.Apply(e);
        return order;
    }

    public Result Confirm()
    {
        if (State != OrderState.Draft) return Errors.OrderNotDraft(Id);
        RaiseAndApply(new OrderConfirmed(Id, DateTimeOffset.UtcNow));
        return Result.Success();
    }

    private void RaiseAndApply(IEvent e) { Apply(e); _pending.Add(e); }

    private void Apply(IEvent e)
    {
        switch (e)
        {
            case OrderCreated c:   Id = c.OrderId; State = OrderState.Draft; break;
            case OrderConfirmed:   State = OrderState.Confirmed; break;
        }
        Version++;
    }
}</code></pre>
<p>Ключевая дисциплина: <strong>метод-команда проверяет правила и порождает событие; метод <code>Apply</code> только меняет состояние и никогда не проверяет правила и не обращается во внешний мир</strong>. Иначе восстановление из истории начнёт отказывать или давать другой результат, когда правила изменятся.</p>
<p><strong>Event store</strong> хранит потоки (stream) событий, обычно поток на агрегат. Минимальная схема на PostgreSQL:</p>
<pre><code>create table events (
    stream_id    uuid        not null,
    version      int         not null,
    type         text        not null,
    data         jsonb       not null,
    metadata     jsonb       not null,   -- correlation id, кто, когда
    recorded_at  timestamptz not null default now(),
    global_position bigserial,
    primary key (stream_id, version)     -- оптимистическая конкурентность
);</code></pre>
<p>Запись идёт с <strong>expected version</strong>: «добавь события в поток X, если его текущая версия N». Если кто-то успел записать N+1, уникальный ключ отклонит вставку — это оптимистическая блокировка без отдельной колонки. Готовые решения: EventStoreDB (ныне KurrentDB), Marten (event store поверх PostgreSQL для .NET), Axon (JVM).</p>

<h3>Snapshots, версионирование и upcasting</h3>
<p><strong>Snapshots.</strong> Если у агрегата тысячи событий, загружать их все на каждую команду дорого. Snapshot — сохранённое состояние агрегата на версии N; загрузка = последний snapshot + события после него. Снапшот — оптимизация, а не источник истины: его можно выбросить и пересчитать. Часто правильный ответ — не снапшоты, а пересмотр границ: агрегат с десятками тысяч событий обычно слишком большой или живёт слишком долго (лучше закрывать период и открывать новый поток, например «смена» или «месяц»).</p>
<p><strong>Версионирование событий</strong> — самая болезненная часть event sourcing, потому что старые события неизменяемы и лежат в хранилище годами, а код меняется. Стратегии (их подробно разбирает Грег Янг в книге «Versioning in an Event Sourced System»):</p>
<ul>
<li><strong>Weak schema / tolerant reader</strong> — новые поля опциональны, отсутствующие получают значение по умолчанию, неизвестные игнорируются. Покрывает большинство изменений.</li>
<li><strong>Новый тип события</strong> — <code>OrderConfirmedV2</code>, а код умеет применять оба. Просто, но типов становится много.</li>
<li><strong>Upcasting</strong> — при чтении старое событие преобразуется в новую форму до того, как попадёт в агрегат. Код домена знает только последнюю версию; преобразования живут в цепочке upcaster-ов на границе хранилища.</li>
<li><strong>Copy-transform (миграция потока)</strong> — потоки переписываются в новый формат. Крайняя мера, нарушает идею неизменяемости, требует аккуратности.</li>
</ul>
<pre><code>// Upcaster: V1 хранил сумму в копейках как int, V2 — Money
public sealed class PaymentReceivedV1ToV2 : IUpcaster
{
    public bool CanUpcast(string type) =&gt; type == "PaymentReceived.v1";

    public (string Type, JsonObject Data) Upcast(JsonObject v1) =&gt;
        ("PaymentReceived.v2", new JsonObject
        {
            ["paymentId"] = v1["paymentId"]?.DeepClone(),
            ["amount"]    = v1["amountKopecks"]!.GetValue&lt;long&gt;() / 100m,
            ["currency"]  = "RUB"
        });
}</code></pre>
<p>Ещё один практический момент — <strong>персональные данные и право на удаление</strong>: неизменяемый лог конфликтует с требованием удалить данные человека. Типичные решения — не класть ПДн в события (хранить ссылку), либо crypto-shredding: шифровать ПДн ключом на субъекта и удалять ключ.</p>

<h3>Цена event sourcing и когда он оправдан</h3>
<p><strong>Что даёт:</strong></p>
<ul>
<li>полный аудит «кто, что и когда» бесплатно и надёжно — история не может разойтись с состоянием, потому что она и есть состояние;</li>
<li>temporal queries: состояние на любой момент в прошлом, «как выглядел заказ до правки»;</li>
<li>возможность строить новые read models задним числом из всей истории;</li>
<li>естественная интеграция: события уже есть, их можно публиковать;</li>
<li>отладка: воспроизвести последовательность, которая привела к багу.</li>
</ul>
<p><strong>Что стоит:</strong></p>
<ul>
<li>сложность: команда должна мыслить событиями, а не таблицами; кривая обучения высокая;</li>
<li>запросы по текущему состоянию невозможны без проекций — «найти все заказы клиента» требует read model;</li>
<li>eventual consistency read models и её последствия для UI («я только что создал, а в списке нет»);</li>
<li>версионирование событий навсегда;</li>
<li>исправление ошибочных данных — не <code>UPDATE</code>, а компенсирующее событие;</li>
<li>мало людей на рынке с реальным опытом, сложнее онбординг.</li>
</ul>
<p>Оправдан, когда история — часть бизнес-ценности: финансы и бухгалтерия (леджер — классический пример), аудит в регулируемых областях, сложные процессы с вопросами «почему так получилось», домены, где события естественны (логистика, трекинг). Не оправдан для CRUD и для систем, где нужна в основном текущая картина.</p>
<p>Промежуточный вариант, который часто лучше полного ES, — хранить текущее состояние как обычно, а важные факты писать в <strong>append-only лог</strong> рядом (движения товара, платежи, история изменений) в той же транзакции. Получаете аудит и историю для того, что действительно её требует, без восстановления агрегатов из событий. Если в вашем проекте есть такой лог фактов, — это хороший материал для истории на собеседовании: почему выбрали его, а не полный event sourcing.</p>

<h3>Eventual consistency проекций в UI и API</h3>
<p>Когда read model обновляется асинхронно, пользователь может не увидеть результат своей операции: создал заказ, перешёл в список — заказа нет. Способы с этим жить:</p>
<ul>
<li><strong>Вернуть результат из команды</strong>: команда отвечает созданным объектом или его идентификатором с версией, и UI показывает его сразу, не перечитывая список.</li>
<li><strong>Read-your-writes по версии</strong>: команда возвращает позицию/версию события, а запрос чтения передаёт её и ждёт (с таймаутом), пока проекция догонит.</li>
<li><strong>Оптимистичный UI</strong>: клиент сразу рисует ожидаемый результат и сверяется позже.</li>
<li><strong>Синхронная проекция</strong> для критичных read models в той же транзакции (в Marten это inline projections), а асинхронная — для тяжёлых и некритичных.</li>
<li><strong>Честный UX</strong>: «изменения появятся через несколько секунд» для отчётов и аналитики.</li>
</ul>
<p>Отдельно — проверки на стороне записи <strong>не должны</strong> опираться на асинхронную read model. Правило «нельзя забронировать больше, чем есть» нельзя проверять по отстающей проекции: два запроса прочитают одно и то же старое значение и оба пройдут. Такие проверки делаются на write-модели под блокировкой или констрейнтом.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Что такое CQRS? Обязательно ли нужны две базы?»</summary>
<p>CQRS — разделение модели записи и модели чтения на уровне архитектуры, развитие принципа CQS Мейера. Модель записи защищает инварианты и работает с агрегатом, модель чтения отдаёт данные в форме, удобной клиенту, и не обязана проходить через домен. Две базы не нужны: самая распространённая и, на мой взгляд, самая полезная форма — одна база и одна транзакция, где команды загружают агрегат через репозиторий, а запросы делают проекции прямо в DTO через <code>AsNoTracking</code> и <code>Select</code> или через Dapper. Отдельное хранилище для чтения, асинхронные проекции и event sourcing — следующие ступени, и каждая добавляет eventual consistency и инфраструктуру. Я поднимаюсь на следующую ступень только по конкретной причине: нагрузка на чтение, которую основная база не держит, полнотекстовый поиск или требование истории.</p>
</details>
<details><summary>«MediatR — это CQRS?»</summary>
<p>Нет. MediatR — внутрипроцессный диспетчер: находит хендлер по типу запроса и прогоняет его через pipeline behaviors. CQRS — архитектурное разделение моделей чтения и записи. Можно сделать CQRS без MediatR, просто разделив сервисы команд и запросов, и можно пользоваться MediatR, где команды и запросы ходят через одну и ту же модель и одни и те же репозитории, — это не CQRS. Ценность MediatR в другом: хендлер на use case и сквозная функциональность в behaviors, которую нельзя забыть. Минусы — косвенность вызовов, магия поведений, которые выбирают обработку по типу ответа, и с 2025 года коммерческая лицензия, из-за которой в новых проектах всё чаще берут source-generated Mediator, Wolverine или ручные хендлеры с декораторами.</p>
</details>
<details><summary>«Расскажите, как работает event sourcing. Как восстанавливается состояние?»</summary>
<p>Вместо текущего состояния хранится упорядоченная последовательность неизменяемых событий по потоку на агрегат. Чтобы выполнить команду, загружаем события потока и применяем их по порядку, получая состояние; команда проверяет правила и порождает новые события, которые дописываются в поток с expected version — если кто-то успел записать раньше, уникальность пары поток и версия отклонит запись, это оптимистическая конкурентность. Метод применения события только меняет поля и никогда не проверяет правила, иначе восстановление истории сломается при изменении правил. Для длинных потоков есть снапшоты, но это оптимизация, и часто лучше пересмотреть границы агрегата. Запросы по текущему состоянию делаются через проекции, которые подписаны на поток событий и строят read models.</p>
</details>
<details><summary>«Как версионировать события в event store?»</summary>
<p>Старые события неизменяемы и живут годами, поэтому совместимость надо планировать сразу. Большинство изменений покрывает tolerant reader: новые поля опциональны с разумными значениями по умолчанию, неизвестные игнорируются, поля не переименовываются и не меняют смысл. Если меняется смысл или структура — либо новый тип события, и код умеет применять оба, либо upcasting: при чтении старое событие преобразуется в новую форму цепочкой upcaster-ов на границе хранилища, и домен знает только актуальную версию. Переписывание потоков — крайняя мера. Я бы ещё упомянул метаданные с версией схемы в каждом событии и тесты, которые прогоняют реальные старые события через текущий код. И отдельная тема — персональные данные: их лучше не класть в события вовсе или шифровать ключом на субъекта, чтобы удаление ключа делало данные нечитаемыми.</p>
</details>
<details><summary>«Когда event sourcing не стоит использовать?»</summary>
<p>Когда истории как бизнес-ценности нет, а нужна текущая картина: CRUD, справочники, большинство административных частей. Когда команда не имеет опыта и сроки жёсткие — кривая обучения высокая, и ошибки в версионировании событий или границах потоков дорого исправлять. Когда основные сценарии — сложные запросы по текущему состоянию, ведь каждый потребует проекции и eventual consistency. И когда нужно часто править данные руками — в ES это компенсирующие события, а не <code>UPDATE</code>. Компромисс, который я считаю часто лучшим: обычное хранение состояния плюс append-only лог важных фактов — движений, платежей, изменений — в той же транзакции. Это даёт аудит и историю там, где они нужны, без восстановления агрегатов из событий.</p>
</details>
<details><summary>«Как справиться с тем, что read model отстаёт от записи?»</summary>
<p>Сначала решить, где отставание допустимо: для отчётов и поиска секунды задержки нормальны, для экрана, на который пользователь попадает сразу после действия, — нет. Для второго случая команда возвращает созданный объект или его версию, и клиент показывает его сразу; или запрос чтения ждёт, пока проекция догонит переданную версию; или проекция для этого экрана обновляется синхронно в той же транзакции. Отставание — метрика с алертом, а проекции — идемпотентные и перестраиваемые. И главное правило: бизнес-проверки на стороне записи никогда не опираются на асинхронную read model, потому что два конкурентных запроса прочитают одно и то же устаревшее значение; такие проверки делаются на write-модели под блокировкой, версией или констрейнтом.</p>
</details>
<details><summary>«Какие pipeline behaviors вы используете и в каком порядке?»</summary>
<p>Снаружи внутрь: логирование и трассировка с correlation id и временем выполнения, затем обработка неожиданных исключений, затем валидация входных данных через FluentValidation, затем авторизация на уровне use case, затем транзакция или unit of work для команд, и только потом хендлер. Порядок важен: валидация должна отработать до открытия транзакции, а логирование — видеть всё, включая отказ валидации. Кэширование ставлю только для запросов и по маркерному интерфейсу. Behaviors, которые меняют ответ, например скрывают поля по правам, я считаю рискованными: они переключаются по типу ответа, и если тот же DTO окажется внутри другого ответа, обработка его пропустит. Такие места я закрываю тестами, которые проходят по всем типам ответов и проверяют, что ничего не протекает.</p>
</details>
`
    },
    {
      id: 'sagas',
      title: 'Распределённые транзакции и саги',
      html: `
<h3>Почему распределённые транзакции трудны</h3>
<p>В монолите с одной базой бизнес-операция «оформить заказ» — одна ACID-транзакция: резерв товара, списание денег и запись доставки либо применяются вместе, либо не применяются вовсе. Как только у склада, платежей и доставки свои сервисы и свои базы, общей транзакции нет. Каждый сервис может атомарно изменить только свою базу.</p>
<p>Классический ответ из мира СУБД — <strong>двухфазный коммит (2PC)</strong>, стандартизованный для разнородных ресурсов как <strong>XA</strong>. Координатор сначала спрашивает всех участников «готовы?» (prepare: каждый записывает изменения в журнал и держит блокировки), и если все ответили «да», рассылает «коммит». Почему между микросервисами его почти не используют:</p>
<ul>
<li><strong>Блокирующий протокол.</strong> Участник, ответивший «готов», не может сам ни закоммитить, ни откатить — он ждёт решения координатора, удерживая блокировки. Если координатор упал между фазами, участники зависают (in-doubt transactions) до его восстановления.</li>
<li><strong>Доступность.</strong> Операция доступна, только если доступны все участники одновременно: доступность перемножается, а задержка определяется самым медленным.</li>
<li><strong>Поддержка.</strong> Kafka, большинство NoSQL, внешние HTTP-API (платёжный шлюз, перевозчик) в XA не участвуют вообще.</li>
<li><strong>Связность.</strong> Сервисы оказываются связаны в одну транзакционную единицу — то, от чего уходили, разделяя их.</li>
</ul>
<p>Оговорка из sysdesign-раздела остаётся в силе: внутри одной распределённой СУБД (Spanner, CockroachDB, YDB) атомарные коммиты по шардам поверх консенсуса работают нормально. Избегают именно 2PC <em>между независимыми сервисами</em>.</p>
<p>Отдельная, более приземлённая проблема — <strong>dual write</strong>: сервис в одной операции пишет в свою базу и публикует событие в брокер. Это две системы без общей транзакции, и любой порядок ломается: сначала база, потом брокер — процесс упал между ними, событие потеряно; сначала брокер, потом база — база откатилась, а мир уже узнал о том, чего не было. Решение — Transactional Outbox (подробно — в главе о паттернах распределённых систем). Саги без outbox (или эквивалента) ненадёжны в каждом шаге.</p>

<h3>Сага: локальные транзакции и компенсации</h3>
<p>Паттерн <strong>Saga</strong> описали Гектор Гарсиа-Молина и Кеннет Салем в статье 1987 года «Sagas» — изначально для длинных транзакций внутри одной базы, которые нельзя держать открытыми часами. Идея перенеслась на микросервисы почти без изменений:</p>
<ul>
<li>сага — последовательность <strong>локальных транзакций</strong> T1, T2, … Tn, каждая в своём сервисе и своей базе;</li>
<li>каждая Ti (кроме последних, о них ниже) имеет <strong>компенсирующую транзакцию</strong> Ci, которая семантически отменяет её эффект;</li>
<li>если Tk не удалась, выполняются компенсации уже сделанных шагов в обратном порядке: Ck−1, …, C1.</li>
</ul>
<p>Три вещи, которые стоит сказать чётко:</p>
<ol>
<li><strong>Компенсация — это не rollback.</strong> Откат базы стирает изменения так, будто их не было. Компенсация — новая бизнес-операция поверх уже зафиксированного и, возможно, уже увиденного кем-то состояния: «снять резерв», «вернуть деньги», «отменить бронь доставки». Деньги, которые вернули, оставляют след в выписке; письмо «заказ принят» уже ушло, и компенсацией будет письмо «заказ отменён».</li>
<li><strong>Компенсация может не удаться.</strong> Платёжный шлюз недоступен, когда нужно вернуть деньги. Поэтому компенсации проектируются <strong>повторяемыми до успеха</strong>: идемпотентными (возврат по ключу платежа, второй вызов ничего не делает) и с ретраями. Сага, которая «не смогла откатиться», не имеет права просто остановиться — она ретраит, а в крайнем случае передаёт дело человеку (dead letter, задача оператору).</li>
<li><strong>Нет изоляции.</strong> Сага даёт атомарность в смысле «в итоге либо всё, либо компенсировано», консистентность и долговечность, но не изоляцию: промежуточные состояния видны другим транзакциям. Это источник аномалий, о которых ниже.</li>
</ol>
<blockquote><strong>Важно.</strong> Сага — не способ «эмулировать ACID». Это признание того, что бизнес-процесс растянут во времени и между системами, и что откат — тоже бизнес-процесс со своими правилами. Хороший признак зрелого ответа — когда вы обсуждаете компенсации с бизнесом («что делаем, если оплата прошла, а доставку не забронировать?»), а не только с кодом.</blockquote>

<h3>Хореография и оркестрация</h3>
<p>Есть два способа координировать шаги.</p>
<p><strong>Хореография</strong> — центра нет. Каждый сервис слушает события и сам решает, что делать: заказ публикует <code>OrderPlaced</code>, склад резервирует и публикует <code>StockReserved</code>, платежи слышат его и списывают деньги, публикуя <code>PaymentCharged</code>, и так далее. Компенсации тоже реагируют на события (<code>PaymentFailed</code> → склад снимает резерв).</p>
<ul>
<li>Плюсы: нет единой точки, слабая связанность в смысле «сервисы не знают друг о друге, только о событиях», легко добавить подписчика.</li>
<li>Минусы: процесс нигде не описан целиком — он размазан по подпискам нескольких сервисов; трудно ответить «на каком шаге этот заказ?»; растёт риск циклических зависимостей событий; тесты процесса целиком сложны; добавление шага требует правок в нескольких командах.</li>
</ul>
<p><strong>Оркестрация</strong> — есть оркестратор (orchestrator, иногда его называют process manager), который явно отправляет команды участникам и реагирует на их ответы: «склад, зарезервируй» → «зарезервировано» → «платежи, спиши» → «не удалось» → «склад, сними резерв».</p>
<ul>
<li>Плюсы: процесс описан в одном месте и читается как код; состояние каждого экземпляра видно; таймауты, ретраи, компенсации и тесты — в одном месте; участники проще — они выполняют команды и не знают о процессе.</li>
<li>Минусы: оркестратор — ещё один компонент, который надо держать доступным; риск, что в него утечёт бизнес-логика участников («умный оркестратор, тупые сервисы»); участники зависят от команд оркестратора.</li>
</ul>
<p>Правило выбора, которое разумно озвучить: два-три шага в рамках одной команды и простая логика без ветвлений — хореография; четыре и больше шагов, несколько команд-владельцев, ветвления, таймауты и сложные компенсации — оркестрация. Можно и смешивать: внутри контекста оркестрация, между контекстами — события.</p>
<p><strong>Оркестратор — это персистентная state machine.</strong> Экземпляр саги живёт минутами или днями, переживает рестарты и деплои, поэтому его состояние (текущий шаг, собранные идентификаторы, счётчики попыток, дедлайны) хранится в базе, а каждый переход — это «получить сообщение → загрузить состояние → решить → сохранить новое состояние и отправить команды» в одной локальной транзакции с outbox. Конкурентные сообщения одному экземпляру обрабатываются с оптимистической блокировкой по версии.</p>

<h3>Типы транзакций в саге и порядок шагов</h3>
<p>Крис Ричардсон в «Microservices Patterns» делит шаги саги на три типа:</p>
<ul>
<li><strong>Compensatable</strong> (компенсируемые) — шаги, которые можно отменить компенсацией: резерв товара, бронь слота доставки, авторизация (холд) платежа.</li>
<li><strong>Pivot</strong> (точка невозврата) — шаг, после успеха которого сага обязана дойти до конца. Он не компенсируется и не повторяется в смысле «попробуем откатить». Если pivot не удался — компенсируем предыдущие шаги; если удался — дальше только вперёд.</li>
<li><strong>Retriable</strong> (повторяемые) — шаги после pivot, которые гарантированно завершатся успехом при повторении: они не могут отказать по бизнес-причине, только временно — и тогда ретраятся.</li>
</ul>
<p>Структура правильной саги: <strong>compensatable* → pivot → retriable*</strong>. Отсюда практическое правило — <strong>ставить pivot как можно позже</strong>, а всё, что может отказать по бизнес-причине («товара нет», «слот занят», «лимит превышен»), — до него. Тогда большинство отказов ловится на компенсируемой стадии, а после точки невозврата остаются только шаги, которые могут лишь «задержаться».</p>
<p>Отсюда же приём <strong>разделения шага на два</strong>: «списать деньги» превращается в «авторизовать (холд)» — компенсируемый шаг в начале — и «подтвердить списание (capture)» — поздний шаг. Аналогично «зарезервировать» и «подтвердить резерв». Некомпенсируемые по природе действия — отправить письмо клиенту, передать отчётность во внешнюю систему, отпечатать этикетку — переносятся за pivot.</p>
<p>Шаги, которые только читают и проверяют (кредитный лимит, адрес в зоне доставки), тоже лучше выполнять в начале: если проверка не прошла, компенсировать нечего.</p>

<h3>Отсутствие изоляции: аномалии и контрмеры</h3>
<p>Пока сага идёт, её промежуточные изменения уже зафиксированы и видны. Ричардсон называет три аномалии:</p>
<ul>
<li><strong>Lost update</strong> — одна сага перезаписывает изменения другой, не прочитав их. Пример: сага отмены заказа и сага изменения заказа пишут в одну запись, и последний побеждает.</li>
<li><strong>Dirty read</strong> — транзакция читает изменения саги, которая ещё не завершилась и может быть компенсирована. Пример: сага уменьшила доступный кредит клиента, другая сага прочитала уменьшенное значение и отказала, после чего первая сага компенсировалась.</li>
<li><strong>Fuzzy / nonrepeatable read</strong> — два шага одной саги читают одни и те же данные и получают разные результаты, потому что между ними другая сага их изменила.</li>
</ul>
<p>Контрмеры (countermeasures), которые он описывает:</p>
<ul>
<li><strong>Semantic lock</strong> — компенсируемый шаг ставит на запись флаг-состояние «в процессе»: заказ в <code>ApprovalPending</code>, резерв в <code>Pending</code>. Другие операции видят флаг и либо отказывают, либо ждут, либо работают с учётом его. Финальный шаг или компенсация снимает флаг. Это самый частый приём, и состояния вида <code>*_PENDING</code> — его признак.</li>
<li><strong>Commutative updates</strong> — операции проектируются коммутативными, так что порядок неважен: «уменьшить на 100» и «увеличить на 100» вместо «установить 500». Тогда компенсация не затирает чужие изменения.</li>
<li><strong>Pessimistic view</strong> — переупорядочить шаги так, чтобы минимизировать бизнес-риск грязного чтения: например, увеличение доступного кредита делать в retriable-шаге, а уменьшение — в компенсируемом. Тогда другие видят худшую, а не лучшую оценку.</li>
<li><strong>Reread value</strong> — перед обновлением перечитать запись и убедиться, что она не изменилась (по сути оптимистическая блокировка); если изменилась — прервать и, возможно, перезапустить сагу.</li>
<li><strong>Version file</strong> — запоминать операции над записью, чтобы переупорядочить их, если они пришли не по порядку (например, «отменить авторизацию» пришло раньше «авторизовать»).</li>
<li><strong>By value</strong> — выбирать механизм по бизнес-риску каждого запроса: дорогие и рискованные операции идут через распределённую транзакцию или более строгий протокол, дешёвые — через сагу.</li>
</ul>
<p>На собеседовании обычно достаточно глубоко знать semantic lock и commutative updates и уметь объяснить, почему без них сага даёт аномалии.</p>

<h3>Надёжность: outbox, идемпотентность, таймауты</h3>
<p>Сага надёжна ровно настолько, насколько надёжен каждый её переход. Обязательная «сантехника»:</p>
<ul>
<li><strong>Outbox</strong> на каждом шаге: участник меняет свою базу и записывает исходящее событие/ответ в outbox в одной транзакции; оркестратор так же сохраняет новое состояние и исходящие команды. Без этого dual write теряет шаги.</li>
<li><strong>Идемпотентные обработчики и inbox.</strong> Брокер доставляет at-least-once, outbox — тоже, поэтому любое сообщение может прийти дважды. Участник либо хранит обработанные message id в таблице inbox (в той же транзакции, что и эффект), либо делает операцию естественно идемпотентной по бизнес-ключу (резерв по <code>orderId</code>: второй запрос возвращает уже существующий резерв).</li>
<li><strong>Таймауты и дедлайны.</strong> Участник может не ответить никогда. Оркестратор планирует отложенное сообщение-таймаут («если через 5 минут нет ответа от платежей…») и по нему ретраит или компенсирует. Для процесса в целом — дедлайн: заказ, не оплаченный за 30 минут, отменяется.</li>
<li><strong>Ретраи с exponential backoff и jitter</strong> для временных ошибок; ошибки бизнес-уровня («недостаточно средств») не ретраятся, а ведут к компенсации.</li>
<li><strong>Dead letter</strong>: сообщения, которые не обрабатываются после N попыток, уходят в отдельную очередь, а экземпляр саги — в состояние «требует внимания» с алертом. Компенсация, которая не может завершиться, — это инцидент, и для него нужен runbook и ручной инструмент.</li>
<li><strong>Observability</strong>: correlation id (обычно id саги или заказа) во всех сообщениях и логах, распределённая трассировка (OpenTelemetry), запрос «состояние саги по заказу» для поддержки, метрики «сколько саг в каждом состоянии и сколько висит дольше N минут».</li>
</ul>
<p>И ещё одно: участники должны принимать сообщения <strong>не по порядку</strong>. Компенсация «снять резерв» может прийти раньше, чем сам резерв, если сообщения пошли разными путями. Участник, получивший отмену несуществующего резерва, запоминает её (tombstone), чтобы последующий запрос резерва для этого заказа был отклонён, — это и есть приём version file в простейшем виде.</p>

<h3>Инструменты в .NET</h3>
<p><strong>MassTransit</strong> — saga state machines (бывшая библиотека Automatonymous, в MassTransit v8 она встроена в сам фреймворк). Состояние — класс, реализующий <code>SagaStateMachineInstance</code> с <code>CorrelationId</code>; машина — наследник <code>MassTransitStateMachine&lt;T&gt;</code>; хранилище состояния — EF Core, MongoDB, Redis, Marten и другие; есть встроенный EF Core outbox и планировщик для таймаутов. Стоит знать про лицензию: в 2025 году авторы объявили, что следующая мажорная версия (v9) будет коммерческой, а v8 остаётся открытой, — уточняйте текущее состояние перед выбором.</p>
<p><strong>NServiceBus</strong> (Particular Software, коммерческий) — саги как класс <code>Saga&lt;TData&gt;</code> с обработчиками сообщений, <code>IAmStartedByMessages&lt;T&gt;</code>, корреляцией через <code>ConfigureHowToFindSaga</code> и таймаутами через <code>RequestTimeout</code>. Зрелый инструмент с хорошими гарантиями и мониторингом.</p>
<p><strong>Ручной оркестратор над таблицей</strong> — вполне легитимный вариант, если шагов немного: таблица <code>order_sagas</code> (id, state, version, данные шагов, deadline), консьюмер ответов, который загружает строку, делает переход, сохраняет с проверкой версии и пишет команды в outbox, и фоновый процесс, который ищет просроченные дедлайны. Плюсы — никакой магии и зависимостей; минусы — всё (таймауты, ретраи, наблюдаемость) пишете сами.</p>
<p><strong>Durable execution</strong> — альтернативная идея: вы пишете процесс как обычный последовательный код с <code>await</code>, а движок (Temporal — у него есть .NET SDK; Azure Durable Functions; Dapr Workflow) записывает историю выполнения и после падения воспроизводит код, пропуская уже выполненные шаги. Компенсации пишутся как <code>try/catch</code>. Плюс — процесс читается как код, таймеры и ретраи бесплатны; минус — требования к детерминированности кода workflow (нельзя напрямую брать текущее время, случайные числа или делать I/O вне activities) и отдельная инфраструктура.</p>

<h3>Пример: заказ со складом, оплатой и доставкой</h3>
<p>Сценарий: клиент оформляет заказ. Нужно зарезервировать товар на складе, забронировать слот доставки и списать оплату. Расставим шаги по типам:</p>
<table>
<thead><tr><th>№</th><th>Шаг</th><th>Тип</th><th>Компенсация</th></tr></thead>
<tbody>
<tr><td>1</td><td>Заказ создан в состоянии <code>Pending</code> (semantic lock)</td><td>compensatable</td><td>Перевести в <code>Rejected</code></td></tr>
<tr><td>2</td><td>Склад: зарезервировать товар</td><td>compensatable</td><td>Снять резерв</td></tr>
<tr><td>3</td><td>Доставка: забронировать слот</td><td>compensatable</td><td>Отменить бронь слота</td></tr>
<tr><td>4</td><td>Платежи: списать оплату</td><td><strong>pivot</strong></td><td>—</td></tr>
<tr><td>5</td><td>Склад: подтвердить резерв → задание на сборку</td><td>retriable</td><td>—</td></tr>
<tr><td>6</td><td>Доставка: подтвердить слот</td><td>retriable</td><td>—</td></tr>
<tr><td>7</td><td>Заказ: <code>Confirmed</code>, письмо клиенту</td><td>retriable</td><td>—</td></tr>
</tbody>
</table>
<p>Бронь доставки стоит <em>до</em> оплаты, потому что она может отказать по бизнес-причине («нет слотов») — так pivot оказывается как можно позже. После успешной оплаты резерв и слот уже держатся, и их подтверждение не может отказать — только задержаться, поэтому шаги 5–7 ретраятся до успеха. Если списание не прошло, компенсируем 3 → 2 → 1 в обратном порядке.</p>
<pre><code>Pending
  └─ OrderSubmitted ─────────► ReservingStock      (send ReserveStock)
ReservingStock
  ├─ StockReserved ──────────► BookingDelivery     (send BookSlot)
  └─ StockUnavailable ───────► Rejected
BookingDelivery
  ├─ SlotBooked ─────────────► Charging            (send ChargePayment, schedule timeout)
  └─ NoSlots ────────────────► Compensating        (send ReleaseStock)
Charging
  ├─ PaymentCharged ─────────► Completing          (send ConfirmReservation, ConfirmSlot)  ← точка невозврата пройдена
  ├─ PaymentDeclined ────────► Compensating        (send CancelSlot, ReleaseStock)
  └─ PaymentTimeout ─────────► (запросить статус платежа; без ответа — Compensating)
Completing
  └─ все подтверждения ──────► Confirmed           (ретраи до успеха, алерт по дедлайну)
Compensating
  └─ все компенсации ────────► Rejected            (ретраи до успеха, иначе — оператору)</code></pre>
<p>Скетч на MassTransit (упрощённо, без всех событий):</p>
<pre><code>public sealed class OrderSagaState : SagaStateMachineInstance
{
    public Guid CorrelationId { get; set; }          // = OrderId
    public string CurrentState { get; set; } = null!;
    public Guid? ReservationId { get; set; }
    public Guid? SlotId { get; set; }
    public Guid? PaymentTimeoutToken { get; set; }
    public uint Version { get; set; }               // оптимистическая блокировка
}

public sealed class OrderSaga : MassTransitStateMachine&lt;OrderSagaState&gt;
{
    public State ReservingStock { get; private set; } = null!;
    public State BookingDelivery { get; private set; } = null!;
    public State Charging { get; private set; } = null!;
    public State Compensating { get; private set; } = null!;

    public Event&lt;OrderSubmitted&gt; Submitted { get; private set; } = null!;
    public Event&lt;StockReserved&gt; Reserved { get; private set; } = null!;
    public Event&lt;SlotBooked&gt; Booked { get; private set; } = null!;
    public Event&lt;PaymentDeclined&gt; Declined { get; private set; } = null!;

    public OrderSaga()
    {
        InstanceState(x =&gt; x.CurrentState);
        Event(() =&gt; Submitted, e =&gt; e.CorrelateById(m =&gt; m.Message.OrderId));
        Event(() =&gt; Reserved,  e =&gt; e.CorrelateById(m =&gt; m.Message.OrderId));
        Event(() =&gt; Booked,    e =&gt; e.CorrelateById(m =&gt; m.Message.OrderId));
        Event(() =&gt; Declined,  e =&gt; e.CorrelateById(m =&gt; m.Message.OrderId));

        Initially(
            When(Submitted)
                .Publish(ctx =&gt; new ReserveStock(ctx.Saga.CorrelationId, ctx.Message.Lines))
                .TransitionTo(ReservingStock));

        During(ReservingStock,
            When(Reserved)
                .Then(ctx =&gt; ctx.Saga.ReservationId = ctx.Message.ReservationId)
                .Publish(ctx =&gt; new BookSlot(ctx.Saga.CorrelationId))
                .TransitionTo(BookingDelivery));

        During(BookingDelivery,
            When(Booked)
                .Then(ctx =&gt; ctx.Saga.SlotId = ctx.Message.SlotId)
                .Publish(ctx =&gt; new ChargePayment(ctx.Saga.CorrelationId))
                .TransitionTo(Charging));

        During(Charging,
            When(Declined)
                .Publish(ctx =&gt; new CancelSlot(ctx.Saga.CorrelationId, ctx.Saga.SlotId!.Value))
                .Publish(ctx =&gt; new ReleaseStock(ctx.Saga.CorrelationId, ctx.Saga.ReservationId!.Value))
                .TransitionTo(Compensating));
    }
}</code></pre>
<p>В реальном коде команды обычно отправляют в конкретную очередь участника (<code>Send</code>), а не публикуют, добавляют таймауты через планировщик, а хранилище — EF Core-репозиторий саги с включённым outbox, чтобы сохранение состояния и исходящие сообщения были одной транзакцией.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Почему не использовать 2PC между микросервисами?»</summary>
<p>Двухфазный коммит блокирующий: участник, проголосовавший «готов», держит блокировки и не может сам решить исход, пока не услышит координатора, и падение координатора между фазами оставляет участников в подвешенном состоянии. Доступность операции становится произведением доступностей всех участников, а задержка — задержкой самого медленного. Брокеры вроде Kafka, большинство NoSQL-хранилищ и внешние HTTP-API в XA не участвуют вовсе, так что даже технически его часто не применить. И он связывает сервисы в единую транзакционную единицу, лишая их независимости. Вместо этого используются саги с локальными транзакциями, outbox и идемпотентные потребители. Оговорюсь, что внутри одной распределённой СУБД атомарный коммит по шардам поверх консенсуса — нормальная вещь; избегают 2PC именно между независимыми сервисами.</p>
</details>
<details><summary>«Что такое компенсирующая транзакция и чем она отличается от отката?»</summary>
<p>Откат стирает незафиксированные изменения так, будто их не было, и никто их не видел. Компенсация — новая бизнес-операция, которая семантически отменяет уже зафиксированный и, возможно, уже увиденный эффект: снять резерв, вернуть деньги, отправить письмо об отмене. Поэтому она оставляет след — возврат виден в выписке — и её смысл определяет бизнес, а не база: отмена брони может быть бесплатной в течение часа и платной потом. Компенсация может сама не удаться, поэтому её делают идемпотентной и повторяемой до успеха, а если она всё равно застряла — это инцидент с алертом и ручным разбором, а не тихая остановка. И не каждое действие компенсируемо: отправленное уведомление или переданную во внешнюю систему отчётность не отзовёшь, такие шаги ставят после точки невозврата.</p>
</details>
<details><summary>«Хореография или оркестрация — как выбираете?»</summary>
<p>Хореография — каждый сервис реагирует на события и публикует свои, центра нет; оркестрация — процесс-оркестратор явно отправляет команды участникам и реагирует на ответы. Хореография проще для двух-трёх шагов внутри одной команды и не создаёт дополнительного компонента, но процесс нигде не описан целиком, на вопрос «где застрял этот заказ» ответить трудно, а добавление шага требует правок у нескольких команд. Оркестрация даёт процесс в одном месте, видимое состояние каждого экземпляра, централизованные таймауты, ретраи и компенсации и простые тесты; цена — ещё один компонент и риск затащить в него логику участников. Для четырёх и более шагов, нескольких команд-владельцев и сложных компенсаций я выбираю оркестрацию, оркестратор реализую как персистентную state machine. Между bounded contexts часто остаются события, а внутри контекста — оркестрация.</p>
</details>
<details><summary>«Что такое pivot transaction и как расставлять шаги саги?»</summary>
<p>По классификации Ричардсона шаги бывают компенсируемые, pivot и повторяемые. Pivot — точка невозврата: после её успеха сага обязана завершиться, дальше идут только повторяемые шаги, которые могут задержаться, но не могут отказать по бизнес-причине. Правильная форма — компенсируемые шаги, затем pivot, затем повторяемые. Отсюда правило: pivot ставится как можно позже, а всё, что может отказать по бизнес-причине — нет товара, нет слота, проверка лимита, — переносится до него. Часто помогает разделить шаг на два: авторизация платежа в начале как компенсируемый шаг и capture позже, или резерв и подтверждение резерва. Некомпенсируемые действия вроде уведомлений клиенту ставятся после pivot.</p>
</details>
<details><summary>«Сага не даёт изоляции. Какие аномалии возникают и как с ними бороться?»</summary>
<p>Промежуточные шаги саги зафиксированы и видны, поэтому возможны lost update, когда одна сага затирает изменения другой, dirty read, когда кто-то читает данные саги, которая потом будет компенсирована, и nonrepeatable read, когда два шага одной саги видят разные данные. Основная контрмера — semantic lock: компенсируемый шаг ставит записи состояние «в процессе», вроде <code>Pending</code>, и остальные операции с ним считаются — ждут, отказывают или учитывают. Вторая — коммутативные обновления: «уменьшить на сумму» вместо «установить значение», тогда компенсация не затирает чужие изменения. Ещё есть pessimistic view — порядок шагов, при котором грязное чтение даёт худшую, а не лучшую оценку; reread value — перепроверка перед записью, по сути оптимистическая блокировка; version file — запоминание операций, пришедших не по порядку; и by value — выбор механизма по уровню риска операции.</p>
</details>
<details><summary>«Как сделать сагу надёжной при сбоях?»</summary>
<p>Каждый переход — локальная транзакция, где изменение данных и исходящие сообщения пишутся вместе через outbox, иначе dual write потеряет шаг. Доставка at-least-once, поэтому все обработчики идемпотентны: либо таблица inbox с id обработанных сообщений в той же транзакции, либо естественная идемпотентность по бизнес-ключу. Состояние оркестратора хранится в базе с оптимистической блокировкой, чтобы два сообщения одному экземпляру не затёрли друг друга. На каждый ожидаемый ответ — таймаут через отложенное сообщение, на процесс — дедлайн; временные ошибки ретраятся с backoff и jitter, бизнес-отказы ведут к компенсации. Застрявшие сообщения уходят в dead letter, а сага — в состояние «требует внимания» с алертом. И обязательно correlation id во всех сообщениях и логах, трассировка и запрос состояния саги для поддержки.</p>
</details>
<details><summary>«Чем оркестратор саги в MassTransit отличается от подхода durable execution, как в Temporal?»</summary>
<p>В MassTransit оркестратор — явная state machine: вы описываете состояния, события и переходы, а состояние экземпляра хранится как строка в репозитории саги, например через EF Core, и каждое входящее сообщение загружает её, выполняет переход и сохраняет. Процесс видно как граф, но читается он как декларация переходов, а не как последовательность. В durable execution процесс пишется как обычный последовательный код с <code>await</code> и <code>try/catch</code> для компенсаций, а движок записывает историю выполнения и после сбоя воспроизводит код, пропуская выполненные шаги. Это удобнее для длинных и ветвистых процессов, таймеры и ретраи даёт движок, но код workflow должен быть детерминированным, а всё недетерминированное — I/O, время, случайность — выносится в activities, и нужна отдельная инфраструктура. Для нескольких шагов внутри уже существующей шины я бы взял state machine или ручной оркестратор над таблицей.</p>
</details>
`
    },
    {
      id: 'distributed-patterns',
      title: 'Паттерны распределённых систем и интеграции',
      html: `
<h3>Откуда эти паттерны</h3>
<p>Паттерны этой главы собраны из трёх источников, на которые удобно ссылаться на собеседовании:</p>
<ul>
<li><strong>«Enterprise Integration Patterns»</strong> (Грегор Хоп и Бобби Вулф, 2003) — словарь обмена сообщениями: Message Channel, Competing Consumers, Dead Letter Channel, Claim Check, Idempotent Receiver и десятки других. Книга старая, но термины живы во всех брокерах.</li>
<li><strong>microservices.io</strong> Криса Ричардсона и его книга «Microservices Patterns» — Transactional Outbox, Saga, API Gateway, Database per Service, CQRS.</li>
<li><strong>Cloud Design Patterns</strong> в документации Microsoft Azure Architecture Center — Retry, Circuit Breaker, Bulkhead, Cache-Aside, Sidecar, Strangler Fig, Leader Election, Sharding, Throttling, Materialized View.</li>
</ul>
<p>Общая идея всех трёх: сеть ненадёжна, сообщения дублируются и теряются, сервисы падают и тормозят — и вместо того чтобы делать вид, что это не так, система строится так, чтобы <strong>сбой был нормальным режимом работы</strong>. Саги разобраны в предыдущей главе, read models — в главе о CQRS, Anti-Corruption Layer — в стратегическом DDD; здесь они только упоминаются.</p>

<h3>Transactional Outbox: проблема dual write</h3>
<p><strong>Проблема.</strong> Сервис в одной операции должен изменить свою базу и опубликовать событие: заказ подтверждён → <code>OrderConfirmed</code> в Kafka. База и брокер — две системы без общей транзакции.</p>
<pre><code>// Наивно: dual write
await db.SaveChangesAsync(ct);                       // 1. закоммитили
await producer.ProduceAsync("orders", message, ct);  // 2. процесс упал здесь — событие потеряно навсегда</code></pre>
<p>Любой порядок ломается. «Сначала база» — падение или сетевой сбой между шагами теряет событие, и потребители (склад, уведомления, биллинг) никогда не узнают о подтверждении. «Сначала брокер» — событие ушло, а транзакция базы откатилась (конфликт версии, нарушение констрейнта), и мир знает о том, чего не было. Обернуть оба вызова в <code>TransactionScope</code> нельзя: Kafka не участвует в распределённых транзакциях с PostgreSQL, а транзакции самой Kafka (exactly-once) покрывают только запись в Kafka и чтение из неё, но не внешнюю базу.</p>
<p><strong>Решение.</strong> Событие записывается <em>в ту же базу и в ту же транзакцию</em>, что и бизнес-изменение, — в таблицу outbox. Отдельный процесс (relay, message relay) читает outbox и публикует в брокер. Теперь атомарность обеспечивает одна локальная транзакция: либо есть и изменение, и событие, либо ни того, ни другого.</p>
<pre><code>create table outbox_messages (
    id            uuid primary key,          -- он же message id для дедупликации у потребителя
    topic         text        not null,
    partition_key text        not null,      -- обычно id агрегата: порядок в пределах ключа
    type          text        not null,
    payload       jsonb       not null,
    headers       jsonb       not null,      -- correlation id, trace context
    created_at    timestamptz not null default now(),
    processed_at  timestamptz null
);
create index ix_outbox_unprocessed on outbox_messages (created_at) where processed_at is null;</code></pre>

<h3>Transactional Outbox: запись в .NET и relay</h3>
<p>С EF Core запись в outbox естественно делать в той же <code>SaveChanges</code>: собрать доменные события агрегатов, превратить в строки outbox и сохранить вместе с изменениями. Удобное место — <code>SaveChangesInterceptor</code>, чтобы ни один хендлер не мог «забыть».</p>
<pre><code>public sealed class OutboxInterceptor(IIntegrationEventMapper mapper) : SaveChangesInterceptor
{
    public override ValueTask&lt;InterceptionResult&lt;int&gt;&gt; SavingChangesAsync(
        DbContextEventData data, InterceptionResult&lt;int&gt; result, CancellationToken ct = default)
    {
        var db = data.Context!;
        var aggregates = db.ChangeTracker.Entries&lt;IHasDomainEvents&gt;()
                           .Select(e =&gt; e.Entity).Where(a =&gt; a.DomainEvents.Count &gt; 0).ToList();

        foreach (var aggregate in aggregates)
        {
            foreach (var domainEvent in aggregate.DomainEvents)
                if (mapper.TryMap(domainEvent, out var integration))       // наружу — только контракт
                    db.Set&lt;OutboxMessage&gt;().Add(OutboxMessage.From(integration));
            aggregate.ClearEvents();
        }
        return base.SavingChangesAsync(data, result, ct);
    }
}</code></pre>
<p>Изменение агрегата и строки outbox попадают в одну транзакцию <code>SaveChanges</code>. Если используется явная транзакция (<code>BeginTransactionAsync</code>), outbox пишется внутри неё.</p>
<p><strong>Relay вариант 1 — polling.</strong> Фоновый сервис периодически выбирает необработанные строки, публикует и помечает:</p>
<pre><code>// внутри BackgroundService, в цикле
await using var tx = await db.Database.BeginTransactionAsync(ct);
var batch = await db.OutboxMessages
    .FromSql($"""
        select * from outbox_messages
        where processed_at is null
        order by created_at
        limit 100
        for update skip locked
        """)
    .ToListAsync(ct);

foreach (var m in batch)
{
    await producer.ProduceAsync(m.Topic,
        new Message&lt;string, string&gt; { Key = m.PartitionKey, Value = m.Payload, Headers = m.ToKafkaHeaders() }, ct);
    m.ProcessedAt = DateTimeOffset.UtcNow;
}
await db.SaveChangesAsync(ct);
await tx.CommitAsync(ct);</code></pre>
<p><code>FOR UPDATE SKIP LOCKED</code> позволяет нескольким экземплярам relay работать параллельно, не беря одни и те же строки. Плюсы polling-а — простота, ничего, кроме базы, не нужно. Минусы — задержка, равная интервалу опроса, и нагрузка на базу частыми запросами.</p>
<p><strong>Relay вариант 2 — CDC (Change Data Capture).</strong> Debezium читает журнал транзакций базы (в PostgreSQL — logical replication, WAL) и превращает вставки в outbox в сообщения Kafka; для этого у Debezium есть готовое преобразование Outbox Event Router. Плюсы — задержка в миллисекунды, никаких опросов, порядок совпадает с порядком коммитов. Минусы — Kafka Connect и Debezium как отдельная инфраструктура, слот репликации, который надо мониторить (застрявший слот не даёт PostgreSQL удалять WAL и заполняет диск), и сложнее локальная разработка.</p>

<h3>Transactional Outbox: порядок, гарантии, очистка</h3>
<p><strong>Порядок.</strong> Обычно нужен порядок событий в пределах одного агрегата, а не глобальный. В Kafka он обеспечивается одинаковым ключом партиционирования (id агрегата). Ловушки на стороне relay:</p>
<ul>
<li>несколько параллельных relay-ев с <code>SKIP LOCKED</code> могут опубликовать два события одного агрегата в обратном порядке — если порядок важен, распределяйте строки между relay-ями по ключу или публикуйте одним потоком на ключ;</li>
<li>курсор «всё, у чего id больше последнего обработанного» опасен: id и время присваиваются при вставке, а коммитятся транзакции в другом порядке, поэтому строка с меньшим id может стать видимой <em>после</em> того, как курсор её проскочил, — и потеряется. Флаг <code>processed_at</code> такой проблемы не имеет; CDC — тоже, потому что идёт в порядке коммитов.</li>
</ul>
<p><strong>Гарантии — at-least-once.</strong> Relay может опубликовать сообщение и упасть до того, как пометит его обработанным, — после рестарта оно уйдёт снова. Поэтому <strong>потребители обязаны быть идемпотентными</strong> (следующий раздел), а id сообщения — стабильный, из строки outbox, а не генерируемый при отправке. Exactly-once на всём пути «база → брокер → база потребителя» получается только как at-least-once плюс дедупликация.</p>
<p><strong>Очистка.</strong> Таблица растёт бесконечно. Обработанные строки удаляются периодическим заданием (или партиционированием по времени с удалением старых партиций); хранить их несколько дней полезно для разбора инцидентов. При CDC строку можно удалять сразу после вставки в той же транзакции — Debezium увидит вставку в журнале, а таблица останется пустой.</p>
<p><strong>Готовые решения в .NET.</strong> MassTransit Entity Framework outbox (<code>AddEntityFrameworkOutbox&lt;TDbContext&gt;</code> с <code>UseBusOutbox()</code>): сообщения, опубликованные через MassTransit внутри скоупа с <code>DbContext</code>, сохраняются в таблицы outbox при <code>SaveChanges</code> и доставляются фоновым процессом; он же даёт inbox для потребителей. NServiceBus outbox, Wolverine со встроенным outbox. Свой outbox оправдан, когда брокер — Kafka через Confluent-клиент без шины, а требования к формату и порядку свои.</p>
<p><strong>Когда не нужен.</strong> Если событие — необязательное уведомление, потеря которого допустима (метрика, кэш-инвалидация с TTL), или если сам брокер — источник истины (сервис, который только читает топик и пишет в другой, может использовать транзакции Kafka).</p>

<h3>Idempotent Consumer и Inbox</h3>
<p><strong>Проблема.</strong> Почти все брокеры и outbox-релеи дают at-least-once: сообщение может прийти дважды (ребаланс консьюмер-группы до коммита оффсета, повтор после таймаута, повторная публикация relay). Повторная обработка «списать 1000 ₽» спишет 2000.</p>
<p><strong>Решение 1 — естественная идемпотентность.</strong> Операция по бизнес-ключу, повтор которой ничего не меняет: «создать резерв для заказа X», если резерв для X уже есть, — вернуть его; upsert вместо insert; «установить статус» вместо «переключить»; клиент генерирует id записи (платежа, движения), и повтор с тем же id ничего не делает.</p>
<p><strong>Решение 2 — inbox (таблица обработанных сообщений).</strong> В той же транзакции, что и эффект, записывается id сообщения; уникальный ключ отсекает повтор.</p>
<pre><code>public async Task HandleAsync(ConsumeResult&lt;string, string&gt; msg, CancellationToken ct)
{
    var messageId = Guid.Parse(Encoding.UTF8.GetString(msg.Message.Headers.GetLastBytes("message-id")));
    await using var tx = await db.Database.BeginTransactionAsync(ct);

    var inserted = await db.Database.ExecuteSqlAsync($"""
        insert into inbox_messages (consumer, message_id, processed_at)
        values ('stock-reservation', {messageId}, now())
        on conflict do nothing
        """, ct);
    if (inserted == 0) return;                    // уже обработано — молча выходим

    var cmd = JsonSerializer.Deserialize&lt;ReserveStock&gt;(msg.Message.Value)!;
    await reservations.ReserveAsync(cmd, ct);     // эффект в той же транзакции
    await tx.CommitAsync(ct);
}</code></pre>
<p>Подводные камни: inbox работает, только если эффект — в той же базе; если обработчик вызывает внешний API, идемпотентность должна поддерживать и он (idempotency key в запросе к платёжному шлюзу). Таблицу inbox тоже надо чистить — держать id дольше, чем максимальное окно возможного повтора. Оффсет Kafka коммитится <em>после</em> коммита транзакции; иначе падение между ними потеряет сообщение.</p>

<h3>Competing Consumers, Dead Letter Channel, Claim Check</h3>
<p><strong>Competing Consumers.</strong> Несколько экземпляров потребителя читают из одного канала, и каждое сообщение обрабатывает ровно один из них — так масштабируется обработка. В RabbitMQ это несколько консьюмеров на одной очереди; в Kafka — consumer group, где партиции распределяются между экземплярами, поэтому параллелизм ограничен числом партиций. Цена — потеря глобального порядка: в RabbitMQ порядок между консьюмерами не гарантирован совсем, в Kafka сохраняется только внутри партиции. Если нужен порядок по ключу, ключ должен определять партицию, а внутри экземпляра обработка одного ключа — последовательной.</p>
<p><strong>Dead Letter Channel.</strong> Сообщение, которое не удаётся обработать (ядовитое — невалидное, вызывающее исключение — или исчерпавшее ретраи), перекладывается в отдельный канал, чтобы не блокировать остальные. В RabbitMQ — встроенный dead letter exchange; в Kafka встроенного механизма нет, и DLT (dead letter topic) делает приложение или фреймворк. Важно: в Kafka одно ядовитое сообщение без DLT блокирует всю партицию, если потребитель ретраит его бесконечно: отложить одно сообщение Kafka не умеет, и пропустить его можно, только закоммитив оффсет дальше и потеряв сообщение. DLQ — не мусорка: на неё нужен алерт, инструмент просмотра и повторной отправки (redrive) и владелец. Различайте временные ошибки (ретраить с backoff, можно через отдельные retry-топики с задержкой) и постоянные (сразу в DLQ).</p>
<p><strong>Claim Check.</strong> Большой payload (файл, PDF, тяжёлый JSON) не кладётся в сообщение: он сохраняется в хранилище (S3, MinIO, blob), а в сообщение идёт ссылка — «квитанция». Брокеры плохо работают с большими сообщениями: в Kafka максимальный размер сообщения по умолчанию около 1 МБ, и его увеличение бьёт по памяти и репликации. Цена — две системы вместо одной: объект должен существовать дольше, чем любое сообщение со ссылкой на него, и нужны права доступа и очистка.</p>

<h3>Event Notification vs Event-Carried State Transfer</h3>
<p>Мартин Фаулер в статье «What do you mean by Event-Driven?» (2017) различает несколько стилей событийного взаимодействия. Два из них важны для дизайна контрактов:</p>
<ul>
<li><strong>Event Notification</strong> — событие сообщает только факт и идентификатор: <code>OrderConfirmed { orderId }</code>. Потребитель, которому нужны детали, идёт за ними синхронно в сервис-источник. Плюсы — маленький стабильный контракт, данные всегда свежие. Минусы — потребитель зависит от доступности источника, нагрузка на источник растёт с числом потребителей, а к моменту запроса данные могут уже измениться.</li>
<li><strong>Event-Carried State Transfer (ECST)</strong> — событие несёт данные, нужные потребителям: <code>OrderConfirmed { orderId, customerId, lines[], deliveryAddress, total }</code>. Потребитель хранит свою локальную копию и не ходит в источник. Плюсы — автономность и доступность потребителя, нет синхронных вызовов. Минусы — большой контракт, который сложнее версионировать, дублирование данных и eventual consistency копий, риск утечки лишних (в том числе персональных) данных.</li>
</ul>
<p>Остальные два стиля в статье — Event Sourcing и CQRS (они разобраны в отдельной главе). На практике выбирают по потребителю: для склада, которому нужны строки заказа, — ECST; для аудита, которому нужен только факт, — notification. Хорошая практика — <strong>не публиковать доменные события как есть</strong>, а маппить в интеграционные с явным контрактом и схемой (Avro/Protobuf в Schema Registry с правилами совместимости).</p>
<p><strong>Materialized View</strong> (из каталога Azure) — та же идея с другой стороны: потребитель строит у себя заранее подготовленное представление из событий или данных других сервисов, чтобы отвечать на запросы без соединения через сеть. Это read model из главы о CQRS, только на межсервисном уровне.</p>

<h3>Retry, Timeout, Circuit Breaker, Bulkhead</h3>
<p><strong>Timeout.</strong> Любой сетевой вызов без таймаута рано или поздно повесит поток или запрос. Таймаут должен быть у каждого вызова и меньше, чем у вызывающего, а лучше — <strong>дедлайн</strong>, который передаётся по цепочке (<code>CancellationToken</code> внутри процесса, deadline в gRPC между сервисами), чтобы нижние сервисы не работали над запросом, который уже никому не нужен. <code>HttpClient.Timeout</code> по умолчанию — 100 секунд, это почти всегда слишком много.</p>
<p><strong>Retry с exponential backoff и jitter.</strong> Временные ошибки (сетевой сбой, 503, таймаут) ретраятся с растущей задержкой: 200 мс, 400, 800… Jitter — случайный разброс задержки, без которого тысячи клиентов, упавших одновременно, ретраят тоже одновременно и добивают восстанавливающийся сервис. Правила: ретраить только идемпотентные операции (или с idempotency key); ограничивать число попыток и общий бюджет времени; не ретраить на каждом уровне цепочки — три уровня по три попытки дают 27 запросов к нижнему сервису (retry storm); не ретраить 4xx бизнес-ошибки.</p>
<p><strong>Circuit Breaker</strong> (популяризирован Майклом Найгардом в «Release It!»). Если зависимость стабильно отказывает, продолжать бить в неё бессмысленно: тратим ресурсы и мешаем ей восстановиться. Автомат с тремя состояниями: <em>Closed</em> — вызовы идут, ошибки считаются; при превышении порога — <em>Open</em>, вызовы сразу отклоняются (fail fast, fallback); через паузу — <em>Half-Open</em>, пропускается пробный вызов, успех закрывает автомат, неудача снова открывает.</p>
<p><strong>Bulkhead</strong> (переборка, как в корпусе корабля). Изолировать ресурсы так, чтобы отказ одной зависимости не утянул всё: отдельные пулы соединений и лимиты параллельных вызовов на каждую внешнюю систему, отдельные консьюмеры для разных типов работы. Медленный сервис рекомендаций не должен занять все потоки и соединения, нужные оформлению заказа.</p>
<pre><code>// .NET 8+: Microsoft.Extensions.Http.Resilience поверх Polly v8
services.AddHttpClient&lt;ICarrierClient, CarrierClient&gt;()
    .AddStandardResilienceHandler();   // rate limiter, общий таймаут, retry, circuit breaker, таймаут попытки

// Своя конфигурация
services.AddHttpClient&lt;IPaymentsClient, PaymentsClient&gt;()
    .AddResilienceHandler("payments", b =&gt; b
        .AddTimeout(TimeSpan.FromSeconds(10))                      // общий бюджет
        .AddRetry(new HttpRetryStrategyOptions
        {
            MaxRetryAttempts = 3, BackoffType = DelayBackoffType.Exponential, UseJitter = true
        })
        .AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
        {
            FailureRatio = 0.5, MinimumThroughput = 20, BreakDuration = TimeSpan.FromSeconds(30)
        })
        .AddTimeout(TimeSpan.FromSeconds(2)));                     // на одну попытку</code></pre>
<p>Порядок стратегий важен: внешний таймаут ограничивает все попытки вместе, внутренний — каждую. Когда эти паттерны не нужны: внутри процесса, для вызовов к собственной базе (у драйвера свои ретраи, а повтор неидемпотентной транзакции опасен), и вообще — каждая политика должна быть осознанной, иначе ретраи маскируют реальные проблемы.</p>

<h3>Rate Limiting и Cache-Aside</h3>
<p><strong>Rate Limiting / Throttling.</strong> Ограничить число запросов от клиента или к ресурсу, чтобы защитить сервис от перегрузки и злоупотреблений и честно делить ёмкость между тенантами. Алгоритмы: fixed window, sliding window, token bucket (допускает всплески до размера ведра), concurrency limiter (ограничивает одновременные запросы). В ASP.NET Core с .NET 7 — встроенный middleware:</p>
<pre><code>builder.Services.AddRateLimiter(o =&gt;
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("per-tenant", ctx =&gt; RateLimitPartition.GetTokenBucketLimiter(
        ctx.Request.Headers["x-organization-uuid"].ToString(),
        _ =&gt; new TokenBucketRateLimiterOptions
        {
            TokenLimit = 100, TokensPerPeriod = 50, ReplenishmentPeriod = TimeSpan.FromSeconds(1)
        }));
});
app.UseRateLimiter();</code></pre>
<p>Ответ — 429 с заголовком <code>Retry-After</code>. Лимит в памяти одного экземпляра делится на число экземпляров; для точного общего лимита нужен распределённый счётчик (Redis) или лимит на API gateway. Throttling на стороне клиента — уважать 429 и <code>Retry-After</code>, не ретраить мгновенно.</p>
<p><strong>Cache-Aside.</strong> Приложение само управляет кэшем: читает из кэша; при промахе загружает из источника и кладёт в кэш; при записи — обновляет источник и инвалидирует (удаляет) запись в кэше. Проблемы: <em>stampede</em> — при истечении популярного ключа сотни запросов одновременно идут в базу (лечится блокировкой на загрузку ключа, как делает <code>HybridCache</code> в .NET 9, или ранним обновлением); <em>несогласованность</em> — гонка «прочитал старое — записал в кэш после инвалидации» оставляет устаревшее значение до TTL, поэтому TTL обязателен даже при явной инвалидации; инвалидация в нескольких экземплярах при локальном кэше. Кэшировать стоит то, что читается часто, меняется редко и допускает небольшую устарелость; не стоит — данные, по которым принимаются решения на запись (остатки при бронировании).</p>

<h3>API Gateway, BFF, Sidecar</h3>
<p><strong>API Gateway</strong> — единая точка входа для внешних клиентов: маршрутизация к сервисам, TLS, аутентификация, rate limiting, агрегация запросов. В .NET — YARP (reverse proxy от Microsoft) или Ocelot; часто — nginx, Envoy, облачные шлюзы. <strong>BFF (Backend for Frontend)</strong> — отдельный шлюз на каждый тип клиента (мобильное приложение, веб, партнёрский API), который собирает данные в форме, удобной именно ему, и которым владеет команда этого клиента. Риск обоих — бизнес-логика, просочившаяся в шлюз. Подробнее — в главе о монолите и микросервисах.</p>
<p><strong>Sidecar</strong> — вспомогательный процесс, развёрнутый рядом с сервисом (в том же поде Kubernetes) и разделяющий с ним жизненный цикл: прокси service mesh (Envoy в Istio, прокси Linkerd) берёт на себя mTLS, ретраи, метрики и трассировку; Dapr sidecar даёт абстракции над брокерами и хранилищами. Плюсы — сквозная функциональность вне кода и независимо от языка. Минусы — дополнительная задержка на каждый вызов, ресурсы на каждый под и ещё один слой для отладки. Для небольшой системы на одном языке общая библиотека или SDK часто проще.</p>
<p><strong>Strangler Fig</strong> и <strong>Anti-Corruption Layer</strong> — паттерны миграции и изоляции от legacy; разобраны в главах о стратегическом DDD и о монолите.</p>

<h3>Leader Election и Sharding</h3>
<p><strong>Leader Election.</strong> Когда несколько экземпляров сервиса, но некоторая работа должна выполняться одним — периодическое задание, отправка напоминаний, координация, — экземпляры выбирают лидера. Способы: блокировка в базе (в PostgreSQL — advisory lock, <code>pg_try_advisory_lock</code> или <code>pg_try_advisory_xact_lock</code>, кто взял — тот и работает), lease в Kubernetes, etcd или ZooKeeper, lease-блоб в облачном хранилище. Главная тонкость — «лидер» может не знать, что он уже не лидер: процесс завис в GC-паузе, lease истёк, выбран новый, старый проснулся и пишет. Защита — <strong>fencing token</strong> (монотонный номер эпохи лидера, который проверяет хранилище) или, проще, идемпотентность самой работы, так чтобы двойное выполнение не вредило. Часто лучший дизайн — не лидер, а конкурентный захват работы по строкам (<code>SKIP LOCKED</code>), когда любой экземпляр может взять любую порцию.</p>
<p><strong>Sharding.</strong> Горизонтальное разделение данных по ключу между несколькими базами или узлами, когда одна не справляется по объёму или записи. Стратегии: <em>по диапазону</em> (удобны диапазонные запросы, но горячие шарды — например, все свежие записи на последнем), <em>по хешу</em> (равномерно, но диапазонные запросы идут во все шарды), <em>по каталогу/тенанту</em> (таблица соответствия ключ → шард; естественно для SaaS, где крупного клиента можно вынести на отдельный шард). Цена: запросы и транзакции через шарды, перебалансировка при росте (consistent hashing уменьшает перенос данных), уникальность и последовательности через шарды. Шардирование — одно из последних средств: сначала индексы, реплики для чтения, партиционирование таблиц внутри одной базы, кэш, архивирование старых данных. Партиции Kafka — тот же шардинг для потока событий, со всеми его следствиями для порядка.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Что такое Transactional Outbox и зачем он нужен?»</summary>
<p>Он решает проблему dual write: операция должна изменить базу и опубликовать событие, а это две системы без общей транзакции, и при любом порядке сбой между шагами либо теряет событие, либо публикует событие об откатившемся изменении. Outbox записывает событие в таблицу той же базы в той же транзакции, что и бизнес-изменение, а отдельный relay читает таблицу и публикует в брокер. Relay бывает polling — выборка необработанных строк с <code>FOR UPDATE SKIP LOCKED</code>, публикация, пометка — или CDC через Debezium по журналу базы с меньшей задержкой и правильным порядком коммитов, но с Kafka Connect и слотом репликации, которые надо мониторить. Гарантия — at-least-once, потому что relay может упасть между публикацией и пометкой, поэтому потребители идемпотентны, а id сообщения стабилен. Порядок обеспечивается ключом партиционирования по агрегату, и надо следить, чтобы параллельные relay-и его не нарушили. Таблица чистится периодически. Удобно реализовать его через перехватчик <code>SaveChanges</code>: тогда ни один хендлер не может забыть записать событие.</p>
</details>
<details><summary>«Почему нельзя просто опубликовать в Kafka после SaveChanges?»</summary>
<p>Потому что между коммитом базы и подтверждением от Kafka процесс может упасть, под может быть убит при деплое, сеть может моргнуть, и событие будет потеряно без следа: заказ подтверждён, а склад об этом никогда не узнает. Ретраи внутри процесса не помогают, потому что умирает сам процесс. Публикация до коммита хуже: транзакция может откатиться из-за конфликта версии или констрейнта, а событие уже ушло. Транзакции Kafka тут не спасают — они атомарны только в пределах Kafka. Распределённую транзакцию с PostgreSQL Kafka не поддерживает. Поэтому событие должно стать частью той же локальной транзакции, а это и есть outbox.</p>
</details>
<details><summary>«Как сделать потребителя идемпотентным?»</summary>
<p>Первый выбор — естественная идемпотентность по бизнес-ключу: создание резерва для заказа, если он уже есть, возвращает существующий; upsert вместо insert; установка значения вместо инкремента; клиентские id для записей, повтор с тем же id ничего не делает. Если так не получается — inbox: в той же транзакции, что и эффект, вставляю id сообщения в таблицу обработанных с уникальным ключом, и если вставка ничего не вставила, сообщение уже обработано. Оффсет в Kafka коммитится только после коммита транзакции, иначе можно потерять сообщение. Если обработчик вызывает внешний API, идемпотентность должна поддерживать и он — например, idempotency key у платёжного шлюза. И inbox надо чистить, храня id дольше окна возможных повторов.</p>
</details>
<details><summary>«Расскажите про retry, circuit breaker и bulkhead. Как они сочетаются?»</summary>
<p>Retry повторяет временные ошибки с экспоненциальной задержкой и jitter, чтобы клиенты не ретраили синхронно; повторять можно только идемпотентные операции, с ограничением попыток и общего времени, и не на каждом уровне цепочки, иначе получится retry storm. Circuit breaker считает ошибки и при превышении порога размыкается: вызовы отклоняются сразу, давая зависимости восстановиться, а через паузу пробный вызов решает, замыкаться ли обратно. Bulkhead изолирует ресурсы — отдельные пулы и лимиты параллельности на каждую зависимость, — чтобы медленный сервис не съел все соединения и потоки. Вокруг всего — таймауты: общий бюджет и таймаут на попытку. В .NET 8 это <code>AddStandardResilienceHandler</code> или своя цепочка Polly v8, где порядок стратегий важен: внешний таймаут охватывает все попытки, внутренний — одну.</p>
</details>
<details><summary>«Event notification или event-carried state transfer?»</summary>
<p>Notification несёт факт и идентификатор, и потребитель за деталями ходит в источник: контракт маленький и стабильный, данные свежие, но потребитель зависит от доступности источника и нагружает его. ECST несёт в событии данные, нужные потребителям, и они хранят локальную копию: автономность и отсутствие синхронных вызовов в обмен на больший контракт, дублирование данных и eventual consistency. Я выбираю по потребителю: складу, который должен собрать заказ, нужны строки, и ходить за ними синхронно в сервис заказов на каждое событие — лишняя связанность, поэтому ECST. Аудиту или нотификациям достаточно факта. В обоих случаях наружу идёт интеграционное событие с явной схемой и правилами совместимости, а не внутреннее доменное событие.</p>
</details>
<details><summary>«Как вы обрабатываете сообщения, которые не удаётся обработать?»</summary>
<p>Сначала различаю временные ошибки — недоступна зависимость, таймаут — и постоянные — невалидный payload, нарушение бизнес-правила, баг. Временные ретраю с backoff, в Kafka иногда через отдельные retry-топики с задержкой, чтобы не блокировать партицию. Постоянные и исчерпавшие попытки отправляю в dead letter: в RabbitMQ это встроенный exchange, в Kafka — отдельный топик, который пишет приложение, с исходными заголовками, причиной и стектрейсом. Без DLT одно ядовитое сообщение в Kafka блокирует всю партицию. На DLQ должен быть алерт, владелец и инструмент повторной отправки после исправления. И важно понимать, что пропуск сообщения может нарушить порядок для его ключа, поэтому иногда правильнее остановить обработку ключа, а не всей партиции.</p>
</details>
<details><summary>«Как гарантировать, что фоновое задание выполняет только один экземпляр сервиса?»</summary>
<p>Самый простой вариант — advisory lock в PostgreSQL: каждый экземпляр пытается взять <code>pg_try_advisory_xact_lock</code>, кто взял — работает, остальные пропускают такт. Есть lease в Kubernetes, etcd, ZooKeeper. Но любая выборка лидера имеет проблему зомби-лидера: процесс завис, lease истёк, выбрали нового, старый проснулся и продолжает писать. Поэтому я делаю работу идемпотентной — например, напоминание отправляется один раз по ключу «что и о каком моменте», и повтор просто ничего не делает; тогда блокировка экономит работу, а корректность гарантирует ключ. В строгих случаях — fencing token, монотонный номер эпохи, который проверяет хранилище. Часто лучше вообще без лидера: экземпляры конкурентно забирают порции работы через <code>FOR UPDATE SKIP LOCKED</code>.</p>
</details>
<details><summary>«Когда вы бы стали шардировать базу?»</summary>
<p>Как можно позже, потому что шардирование ломает транзакции и запросы через шарды, усложняет уникальность, миграции и перебалансировку. До него — индексы и оптимизация запросов, реплики для чтения, кэш, партиционирование таблиц внутри одной базы, архивирование старых данных, вынос тяжёлой аналитики в отдельное хранилище, вертикальное масштабирование. Если всё это исчерпано и упираемся в объём или запись, выбираю ключ так, чтобы большинство операций попадали в один шард: для SaaS естественный ключ — тенант, и крупного клиента можно вынести отдельно. Хеш даёт равномерность, но убивает диапазонные запросы; диапазоны удобны, но дают горячие шарды. И нужно заранее решить, как добавлять шарды, — consistent hashing или каталог.</p>
</details>
`
    },
    {
      id: 'errors',
      title: 'Обработка ошибок как архитектурное решение',
      html: `
<h3>Почему обработка ошибок — архитектурное решение</h3>
<p>Обработку ошибок часто считают деталью реализации: «бросим исключение, middleware превратит его в 500». Но от того, как система сообщает об ошибках, зависит очень многое: контракт API (что клиент получит и сможет ли отреагировать программно), локализация, наблюдаемость (что считать инцидентом, а что нормальным отказом), производительность, читаемость кода и то, насколько легко забыть обработать сбой. Решение принимается один раз на проект и потом тиражируется в сотни мест, поэтому его стоит принимать осознанно.</p>
<p>Ключевой вопрос, который задаёт тон всей главе: <strong>какие бывают ошибки</strong>. Полезная классификация:</p>
<table>
<thead><tr><th>Вид</th><th>Пример</th><th>Кто виноват</th><th>Как реагировать</th></tr></thead>
<tbody>
<tr><td>Ошибка ввода (валидация)</td><td>Пустое имя, количество −1</td><td>Клиент</td><td>400 с перечнем полей</td></tr>
<tr><td>Бизнес-отказ (доменная ошибка)</td><td>«Заказ уже завершён», «недостаточно остатка»</td><td>Никто, это нормальный исход</td><td>400/409 с кодом, клиент показывает причину</td></tr>
<tr><td>Не найдено / нет доступа</td><td>Заказ другого тенанта</td><td>Клиент</td><td>404/403</td></tr>
<tr><td>Временный инфраструктурный сбой</td><td>Таймаут базы, брокер недоступен</td><td>Среда</td><td>Ретрай, 503, алерт при росте</td></tr>
<tr><td>Баг (нарушение предположения)</td><td>NullReference, невозможное состояние</td><td>Разработчик</td><td>500, лог со стектрейсом, инцидент</td></tr>
</tbody>
</table>
<p>Бизнес-отказ — <strong>ожидаемый</strong> результат операции, как и успех. Баг и инфраструктурный сбой — <strong>неожиданные</strong>. Почти все хорошие архитектурные решения об ошибках вытекают из того, чтобы не смешивать эти два мира.</p>

<h3>Исключения: сильные и слабые стороны</h3>
<p>Исключения в .NET — механизм для <em>исключительных</em> ситуаций. Их сильные стороны:</p>
<ul>
<li>невозможно случайно проигнорировать: необработанное исключение прерывает выполнение;</li>
<li>несут стектрейс — бесценно для багов;</li>
<li>пролетают через любое число уровней без участия промежуточного кода;</li>
<li>естественно откатывают транзакции и освобождают ресурсы через <code>using</code>/<code>finally</code>.</li>
</ul>
<p>Слабые стороны, когда ими сообщают о бизнес-отказах:</p>
<ul>
<li><strong>невидимы в сигнатуре</strong>: <code>Task&lt;Order&gt; ConfirmAsync()</code> не говорит, что может бросить <code>OrderShortageException</code>; в C# нет checked exceptions, поэтому вызывающий узнаёт об этом из документации или в продакшене;</li>
<li><strong>управление потоком через исключения</strong>: <code>try/catch</code> как <code>if</code> — трудно читать, легко поймать лишнее (<code>catch (Exception)</code> проглатывает и бизнес-отказ, и баг);</li>
<li><strong>стоимость</strong>: выброс исключения в .NET на порядки дороже возврата значения из-за сбора стектрейса и раскрутки стека. В .NET 9 обработку исключений значительно ускорили, но это всё равно не бесплатный путь, и при массовых отказах (валидация в высоконагруженном API) это заметно;</li>
<li><strong>шум в мониторинге</strong>: если каждый «недостаточно остатка» — исключение, APM показывает тысячи исключений, и настоящий баг в них тонет.</li>
</ul>
<p>Рекомендация Microsoft в «Framework Design Guidelines» — не использовать исключения для обычного потока управления; для ожидаемых отказов есть паттерн <strong>Try</strong> (<code>int.TryParse</code>, <code>Dictionary.TryGetValue</code>) и возврат результата. Исключения остаются для нарушений контракта (<code>ArgumentException</code> — ошибка вызывающего кода) и сбоев инфраструктуры.</p>

<h3>Result-типы</h3>
<p><strong>Result</strong> (в функциональном программировании — Either) — тип, который явно содержит либо значение успеха, либо ошибку. Ошибка становится частью сигнатуры:</p>
<pre><code>public abstract record Result&lt;T&gt;
{
    public sealed record Success(T Value) : Result&lt;T&gt;;
    public sealed record Failure(Error Error) : Result&lt;T&gt;;

    public static implicit operator Result&lt;T&gt;(T value) =&gt; new Success(value);
    public static implicit operator Result&lt;T&gt;(Error error) =&gt; new Failure(error);
}

public sealed record Error(ErrorCode Code, IReadOnlyDictionary&lt;string, object?&gt; Args);

public Result&lt;Reservation&gt; Reserve(int quantity, Period period)
{
    if (quantity &lt;= 0) return Errors.QuantityMustBePositive(quantity);
    if (Available(period) &lt; quantity) return Errors.Shortage(Id, quantity, Available(period));
    var reservation = new Reservation(Id, quantity, period);
    _reservations.Add(reservation);
    return reservation;
}</code></pre>
<p>Плюсы: вызывающий видит в типе, что операция может отказать, и pattern matching делает обработку обоих случаев явной (хотя полноту <code>switch</code> по иерархии классов компилятор C# не проверяет, а сам Result можно молча отбросить); бизнес-отказы не создают исключений и не шумят в мониторинге; ошибки — данные, их легко сериализовать, логировать и локализовать; композиция через <code>Bind</code>/<code>Map</code> (Railway Oriented Programming — термин Скотта Влашина) позволяет писать цепочки без вложенных <code>if</code>.</p>
<p>Минусы: в C# нет встроенного типа и синтаксического сахара (как <code>?</code> в Rust), поэтому код многословнее: каждый вызов — проверка и ранний возврат. Есть риск «Result всё стерпит» — оборачивать в Result и баги, теряя стектрейсы. Нельзя забыть, что исключения всё равно существуют: база, сеть и фреймворк бросают их, и Result не отменяет глобальный обработчик. Ловушка с <code>struct</code>-реализациями: <code>default(Result&lt;T&gt;)</code> и <code>FirstOrDefault</code> над коллекцией структур возвращают «нулевое» значение, которое может выглядеть как успех или как ошибка без данных.</p>
<p>Библиотеки в .NET: FluentResults, ErrorOr, OneOf (discriminated union), CSharpFunctionalExtensions и другие. Выбор библиотеки менее важен, чем единообразие: один тип ошибки на проект и одно место, где Result превращается в HTTP-ответ.</p>

<h3>Доменные ошибки и инфраструктурные сбои</h3>
<p>Практическое правило, которое хорошо звучит на собеседовании: <strong>ожидаемые отказы — через Result, неожиданные — через исключения</strong>.</p>
<ul>
<li>«Заказ нельзя подтвердить без дат», «модель в архиве», «нарушение лимита» — доменные ошибки. Это часть бизнес-логики, у них есть коды и аргументы, клиент показывает их пользователю. Возвращаются как Result.</li>
<li>Таймаут базы, недоступный Keycloak, переполненный диск — инфраструктурные сбои. Обработать их на уровне домена нечем, поэтому они летят исключениями до глобального обработчика, который логирует, ставит метрику и отвечает 500/503. Ретраи — в инфраструктуре (Polly, ретраи драйвера), а не в доменном коде.</li>
<li>Баги — исключения, и это хорошо: стектрейс указывает место.</li>
</ul>
<p>Пограничные случаи:</p>
<ul>
<li><strong>Нарушение уникальности в базе.</strong> Технически это исключение драйвера (<code>23505</code> в PostgreSQL), но по смыслу — бизнес-отказ «такой асет-тег уже занят». Правильно — проверить заранее и вернуть доменную ошибку, а исключение от индекса при гонке перехватить в одном месте и перевести в ту же ошибку (409).</li>
<li><strong>Конфликт оптимистической блокировки</strong> (<code>DbUpdateConcurrencyException</code>) — ожидаемый в конкурентной системе, переводится в 409 «запись изменена, обновите».</li>
<li><strong>Ошибка внешнего API с бизнес-смыслом</strong> (платёж отклонён) — адаптер переводит её в доменную ошибку, а не пробрасывает HTTP-исключение наружу.</li>
</ul>
<p>Невозможное состояние внутри домена («заказ без строк дошёл до расчёта») — это баг, а не доменная ошибка: <code>throw new InvalidOperationException(...)</code> или <code>UnreachableException</code> (.NET 7). Превращать такое в Result значит прятать баг под видом отказа.</p>

<h3>Коды ошибок и локализация</h3>
<p>Ошибка в API — это <strong>контракт</strong>. Текст сообщения для контракта не годится: он меняется, переводится и не парсится. Устойчивый вариант:</p>
<ul>
<li>каждая ошибка имеет <strong>стабильный код</strong> — строковый (<code>OrderShortage</code>) и/или числовой (<code>11042</code>), который никогда не меняет смысл и не переиспользуется;</li>
<li>к коду прикладываются <strong>аргументы</strong> (<code>{ "assetTag": "LGT-0042", "lifecycle": "Sold" }</code>), чтобы клиент мог построить свой текст;</li>
<li>сервер переводит сообщение по <code>Accept-Language</code> из ресурсов (<code>.resx</code>) с плейсхолдерами, и клиент может показать готовый <code>detail</code>;</li>
<li>формат ответа — <strong>Problem Details</strong> (RFC 9457, заменивший RFC 7807): <code>type</code>, <code>title</code>, <code>status</code>, <code>detail</code>, <code>instance</code> плюс расширения (<code>code</code>, <code>args</code>, <code>traceId</code>).</li>
</ul>
<pre><code>// Доменная ошибка — без текста, только код и аргументы
public static Error UnitNotBookable(string assetTag, Lifecycle lifecycle) =&gt;
    new(ErrorCode.UnitNotBookable, new Dictionary&lt;string, object?&gt;
    {
        ["assetTag"] = assetTag, ["lifecycle"] = lifecycle
    });

// Граница API: Result → ProblemDetails с переводом
public IActionResult FromResult&lt;T&gt;(Result&lt;T&gt; result, Func&lt;T, IActionResult&gt; onSuccess) =&gt;
    result switch
    {
        Result&lt;T&gt;.Success s =&gt; onSuccess(s.Value),
        Result&lt;T&gt;.Failure f =&gt; ErrorProblem(                          // свой хелпер, собирающий ProblemDetails
            statusCode: StatusFor(f.Error.Code),
            detail: localizer.Format(f.Error.Code, f.Error.Args),   // ErrorMessages.ru.resx
            extensions: new { code = f.Error.Code.ToString(), codeNumber = (int)f.Error.Code, args = f.Error.Args }),
        _ =&gt; throw new UnreachableException()                     // иерархия не закрыта: без этой ветки — предупреждение CS8509
    };</code></pre>
<p>Хорошие практики: группировать числовые коды по областям (1xxx — общие, 5xxx — продукты, 11xxx — заказы), проверять тестом, что у каждого кода есть сообщение на каждом языке с одинаковыми плейсхолдерами, поддерживать плюрализацию (ICU MessageFormat), не раскрывать внутренности (SQL, стектрейс) в ответе, но давать <code>traceId</code>, по которому поддержка найдёт лог. В .NET 8+ для неожиданных исключений — <code>IExceptionHandler</code> и <code>AddProblemDetails()</code>, чтобы и 500 приходил в том же формате.</p>

<h3>Слои валидации: FluentValidation против инвариантов</h3>
<p>Распространённая ошибка — считать, что валидация в одном месте. На деле у неё несколько слоёв с разными задачами:</p>
<ol>
<li><strong>Структурная валидация на границе</strong> — тип JSON, обязательные поля, форматы, длины, диапазоны. Ответ на вопрос «корректно ли сформулирован запрос». Это FluentValidation (или DataAnnotations) на уровне DTO/команды, часто через pipeline behavior или автоматическую валидацию. Ошибки — 400 со списком полей. Быстро, без обращения к базе.</li>
<li><strong>Инварианты домена</strong> — правила, которые должны соблюдаться всегда, независимо от того, откуда пришла команда: из HTTP, из Kafka, из миграции, из теста. Проверяются в агрегатах и value objects. Ошибки — доменные коды.</li>
<li><strong>Правила, зависящие от состояния системы</strong> — уникальность, существование связанных сущностей, права. Проверяются в хендлере или домене с данными из базы.</li>
<li><strong>Гарантии базы</strong> — констрейнты, уникальные индексы, внешние ключи, exclusion constraints. Последний рубеж против гонок, когда две транзакции прошли проверку кода одновременно.</li>
</ol>
<p>Ключевой принцип: <strong>валидация на границе не заменяет инварианты</strong>. Если правило «количество больше нуля» проверяет только валидатор HTTP-команды, то консьюмер Kafka, создающий ту же сущность, его обойдёт. Поэтому важное правило живёт в домене (в value object <code>Quantity</code> или в методе агрегата), а валидатор на границе дублирует его ради хорошего UX (все ошибки полей сразу, до загрузки агрегата). Это допустимое дублирование: у них разные задачи.</p>
<p>Чего не стоит делать: класть в FluentValidation правила, которым нужна база (асинхронные валидаторы с запросами), — они превращают валидатор в хендлер, создают лишние запросы и гонки; проверять в валидаторе бизнес-состояние агрегата («заказ не завершён») — это решение агрегата. И помнить, что валидатор, привязанный к HTTP-модели, не работает для команд, отправленных не через контроллер, — тесты, которые шлют команду напрямую в MediatR, его не увидят.</p>

<h3>Guard clauses</h3>
<p><strong>Guard clause</strong> — проверка предусловий в начале метода с немедленным выходом, вместо вложенных <code>if</code>. Защищает метод от некорректных аргументов и делает «счастливый путь» плоским.</p>
<pre><code>// Без guard clauses — пирамида
public void Move(Unit unit, Location target)
{
    if (unit != null)
    {
        if (target != null)
        {
            if (!target.IsDeleted) { /* ... */ }
        }
    }
}

// С guard clauses
public Result Move(Unit unit, Location target)
{
    ArgumentNullException.ThrowIfNull(unit);
    ArgumentNullException.ThrowIfNull(target);
    if (target.IsDeleted) return Errors.LocationClosed(target.Id);
    if (unit.IsOnOrder) return Errors.UnitOnOrder(unit.AssetTag);

    unit.MoveTo(target);
    return Result.Success();
}</code></pre>
<p>Обратите внимание на два вида проверок. <code>ThrowIfNull</code> — нарушение контракта вызывающим кодом, это баг, поэтому исключение. «Место закрыто» — ожидаемый бизнес-отказ, поэтому Result. В .NET есть встроенные хелперы: <code>ArgumentNullException.ThrowIfNull</code> (.NET 6), <code>ArgumentException.ThrowIfNullOrEmpty</code> и <code>ThrowIfNullOrWhiteSpace</code> (.NET 7–8), <code>ArgumentOutOfRangeException.ThrowIfNegative</code>, <code>ThrowIfZero</code>, <code>ThrowIfGreaterThan</code> (.NET 8). Они используют <code>CallerArgumentExpression</code>, так что имя параметра подставляется само. С nullable reference types многие null-проверки внутри своего кода переносятся на компилятор, и guard на null нужен в основном на публичных границах.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Исключения или Result-типы? Что вы используете и почему?»</summary>
<p>Я разделяю ошибки на ожидаемые и неожиданные. Ожидаемые бизнес-отказы — «заказ завершён», «не хватает остатка», «код занят» — нормальный исход операции, и я возвращаю их как Result: они видны в сигнатуре, вызывающий не узнаёт о них в продакшене, они не стоят раскрутки стека и не шумят в мониторинге как исключения. Неожиданное — баги, нарушения контракта, сбои инфраструктуры — летит исключениями до глобального обработчика, потому что обработать их в домене нечем, а стектрейс нужен. Цена Result в C# — многословность: нет оператора раннего возврата, как <code>?</code> в Rust, и надо следить, чтобы в Result не заворачивали баги. Важно единообразие: один тип ошибки на проект и одно место, где Result превращается в HTTP-ответ.</p>
</details>
<details><summary>«Как вы возвращаете ошибки клиенту API?»</summary>
<p>В формате Problem Details по RFC 9457 с расширениями: стабильный код ошибки, строковый и числовой, аргументы для построения собственного текста, переведённый <code>detail</code> по <code>Accept-Language</code> и <code>traceId</code> для поддержки. Код — контракт: он не меняет смысл и не переиспользуется, а текст может меняться и переводиться, поэтому клиент программно реагирует на код, а не парсит сообщение. Статусы: 400 для валидации и нарушения правил, 404 для несуществующего, включая чужие тенанты, чтобы не раскрывать существование, 409 для конфликтов и гонок, 500 для неожиданного. Внутренние детали — SQL, стектрейсы — в ответ не попадают никогда. Тест проверяет, что у каждого кода есть сообщения на всех языках с одинаковыми плейсхолдерами.</p>
</details>
<details><summary>«Где должна быть валидация: в FluentValidation или в домене?»</summary>
<p>И там, и там, но с разными задачами. FluentValidation на границе проверяет форму запроса — обязательность, форматы, длины, диапазоны — быстро, без базы, и возвращает все ошибки полей сразу, это вопрос UX. Инварианты живут в домене — в value objects и методах агрегатов, — потому что должны соблюдаться независимо от источника команды: HTTP, Kafka, фоновая задача или тест. Если правило «количество положительное» есть только в валидаторе контроллера, консьюмер очереди его обойдёт. Правила, зависящие от данных, — уникальность, существование — проверяет хендлер или домен с данными, а последний рубеж против гонок — констрейнты базы. Асинхронные валидаторы с запросами к базе я не люблю: они дублируют работу хендлера и всё равно не защищают от конкурентности.</p>
</details>
<details><summary>«Как вы отличаете доменную ошибку от инфраструктурной? Приведите пограничный случай»</summary>
<p>Доменная ошибка — результат, который бизнес ожидает и о котором можно сказать пользователю что-то осмысленное. Инфраструктурная — сбой среды, о котором бизнес ничего не знает и который обработать на уровне домена нечем. Пограничный случай — нарушение уникального индекса: технически это исключение драйвера, а по смыслу — «такой асет-тег уже используется». Я проверяю уникальность заранее и возвращаю доменную ошибку, а исключение от индекса, которое может прилететь при гонке двух запросов, перехватываю в одном месте и перевожу в ту же доменную ошибку с 409. Второй пример — отказ платёжного шлюза: адаптер переводит «карта отклонена» в доменную ошибку, а таймаут шлюза оставляет инфраструктурным сбоем с ретраем.</p>
</details>
<details><summary>«Почему не стоит управлять потоком через исключения?»</summary>
<p>Во-первых, исключения невидимы в сигнатуре — в C# нет checked exceptions, и вызывающий не знает, что метод может отказать. Во-вторых, <code>try/catch</code> вместо <code>if</code> плохо читается и легко ловит лишнее: <code>catch (Exception)</code>, написанный ради бизнес-отказа, проглотит и баг. В-третьих, производительность: выброс исключения намного дороже возврата значения, и при массовых отказах это заметно, даже с ускорениями в .NET 9. В-четвёртых, мониторинг: если ожидаемые отказы — исключения, их тысячи, и реальные баги в них тонут. Microsoft в своих гайдлайнах рекомендует для ожидаемых отказов паттерн Try или возврат результата.</p>
</details>
<details><summary>«Что такое guard clause? Исключение или Result в guard-е?»</summary>
<p>Guard clause — проверка предусловий в начале метода с немедленным выходом, которая убирает вложенность и оставляет основной путь плоским. Тип реакции зависит от того, что нарушено. Если нарушен контракт метода вызывающим кодом — передали null или отрицательный индекс, — это баг, и правильно бросить исключение: <code>ArgumentNullException.ThrowIfNull</code>, <code>ArgumentOutOfRangeException.ThrowIfNegative</code>, которые сами подставляют имя аргумента через <code>CallerArgumentExpression</code>. Если же проверка — бизнес-правило, которое может легитимно не выполниться, — место закрыто, единица на заказе, — это ожидаемый исход и Result. С включёнными nullable reference types большинство null-проверок внутри своего кода берёт на себя компилятор, и guard на null остаётся на публичных границах.</p>
</details>
<details><summary>«Как устроить глобальную обработку исключений в ASP.NET Core?»</summary>
<p>В .NET 8 и выше — <code>AddProblemDetails()</code>, реализация <code>IExceptionHandler</code> и <code>UseExceptionHandler()</code> в начале конвейера. Обработчик логирует исключение со стектрейсом и traceId, увеличивает метрику и отвечает Problem Details с 500 без внутренних деталей. Известные инфраструктурные исключения можно перевести в осмысленные статусы: <code>DbUpdateConcurrencyException</code> в 409, отмена запроса клиентом — не логировать как ошибку, таймаут зависимости — в 503 или 504. Важная деталь — порядок middleware: локализация запроса должна стоять до обработчика ошибок, иначе сообщение переведётся не на тот язык. И обработчик не должен становиться местом бизнес-логики: доменные ошибки должны приходить как Result, а не ловиться здесь по типу исключения.</p>
</details>
`
    },
    {
      id: 'monolith',
      title: 'Монолит и микросервисы',
      html: `
<h3>Монолит — не ругательство</h3>
<p>Монолит — приложение, которое разворачивается как одна единица. Это архитектурный стиль, а не синоним «плохого кода». У него есть реальные преимущества: один процесс и вызовы функций вместо сетевых, одна база и ACID-транзакции через всю операцию, простые рефакторинги через всю кодовую базу, один деплой, простая отладка и локальная разработка, отсутствие распределённых отказов.</p>
<p>Проблемы монолита начинаются не от того, что он монолит, а от отсутствия внутренних границ: <strong>Big Ball of Mud</strong>, где любой класс зависит от любого, общие таблицы читаются и пишутся отовсюду, а изменение в одном месте ломает непредсказуемое другое. И организационно: когда в одном репозитории и одном деплое работают десятки команд, они начинают мешать друг другу — очередь на релиз, конфликты, общий CI на час.</p>
<p>Мартин Фаулер писал о «Microservice Premium» — микросервисы добавляют стоимость, которая окупается только при определённой сложности системы, — и о подходе MonolithFirst: начинать с монолита и выделять сервисы, когда границы стали понятны. Есть и противоположное мнение (что разрезать хорошо разделённый монолит потом трудно), и честный ответ на собеседовании признаёт оба.</p>
<blockquote><strong>Важно.</strong> Микросервисы — это прежде всего способ масштабировать <em>организацию</em>: дать командам независимо разрабатывать и релизить. Если команда одна, большинство преимуществ микросервисов недоступно, а все издержки остаются.</blockquote>

<h3>Модульный монолит</h3>
<p><strong>Модульный монолит</strong> — один деплой, но внутри — модули с жёсткими границами, обычно по bounded contexts. Это промежуточная точка, которая даёт большую часть пользы микросервисов (независимость моделей, ясное владение, локальность изменений) без распределённых издержек.</p>
<p>Правила хорошего модульного монолита:</p>
<ul>
<li><strong>Модуль владеет своими данными</strong>: своя схема в базе (<code>catalog.*</code>, <code>orders.*</code>), и никто, кроме модуля, не читает и не пишет его таблицы. Связь между модулями — по идентификаторам, без внешних ключей между схемами (или с ними, но осознанно).</li>
<li><strong>Публичный API модуля</strong> — узкий: интерфейс или набор команд/запросов в отдельном проекте <code>Orders.Contracts</code>, а реализация — <code>internal</code>.</li>
<li><strong>Взаимодействие</strong> — синхронно через публичный API модуля или асинхронно через события (in-process шина или outbox, если хочется подготовиться к выносу).</li>
<li><strong>Границы проверяются автоматически</strong>: ссылки проектов, архитектурные тесты, запрет на обращение к чужой схеме.</li>
</ul>
<pre><code>src/
  Modules/
    Catalog/
      Catalog.Contracts    ← публичные интерфейсы, DTO, интеграционные события
      Catalog.Core         ← internal: домен, хендлеры, DbContext со схемой "catalog"
    Orders/
      Orders.Contracts
      Orders.Core          ← ссылается на Catalog.Contracts, но не на Catalog.Core
  Host/                    ← собирает модули, один процесс, один деплой</code></pre>
<p>Модульный монолит делает будущий вынос сервиса механическим: модуль, который общается только событиями и владеет своей схемой, можно вынести с минимальными изменениями. А если границы оказались неверными, переложить код между модулями в одном репозитории — дни, а не месяцы. Компромиссы: дисциплина держится на людях и тестах, модули делят процесс (утечка памяти в одном валит всех) и темп релизов.</p>

<h3>Критерии разделения на сервисы</h3>
<p>Выделять сервис стоит, когда есть конкретная причина, а не «так современно». Хорошие причины:</p>
<ul>
<li><strong>Независимые команды</strong>: разные команды владеют разными частями и мешают друг другу в одном деплое.</li>
<li><strong>Разный темп изменений</strong>: часть меняется каждый день, другая — раз в квартал и требует стабильности.</li>
<li><strong>Разные требования к масштабированию</strong>: приём телеметрии на сотни тысяч сообщений в секунду и админка с десятью пользователями.</li>
<li><strong>Изоляция отказов</strong>: падение рекомендаций не должно останавливать оформление заказа.</li>
<li><strong>Разные технологии или требования безопасности</strong>: ML на Python, платёжный контур с отдельным периметром (PCI DSS).</li>
<li><strong>Чёткая граница контекста</strong>, проверенная временем: модуль общается с остальными узким API и событиями.</li>
</ul>
<p>Плохие причины: «микросервисы проще поддерживать» (нет — сложность переходит в сеть, деплой и наблюдаемость), «маленький код проще понять» (система целиком сложнее), «чтобы каждый мог выбрать язык» (обычно ведёт к зоопарку), резюме-ориентированная разработка.</p>
<p>Что вы получаете вместе с сервисами: сетевые отказы и задержки, распределённые транзакции (саги), eventual consistency, версионирование контрактов, распределённую трассировку, сложное локальное окружение и тестирование, нагрузку на платформу (CI/CD, Kubernetes, мониторинг). Senior называет эту цену сам, не дожидаясь вопроса.</p>

<h3>Распределённый монолит</h3>
<p><strong>Distributed monolith</strong> — анти-паттерн, где система разбита на сервисы, но сохраняет связанность монолита. Худшее из двух миров: сложность распределённой системы без её независимости. Признаки:</p>
<ul>
<li>сервисы нельзя релизить независимо — фича требует синхронного выпуска нескольких сервисов;</li>
<li>общая база данных, которую читают и пишут несколько сервисов;</li>
<li>длинные синхронные цепочки вызовов: A вызывает B, B вызывает C, и отказ C валит A;</li>
<li>общая библиотека с доменными моделями, обновление которой ломает всех;</li>
<li>«сервис на сущность» — любой сценарий требует обращения к нескольким сервисам;</li>
<li>сервисы не могут работать, если хоть один из соседей недоступен.</li>
</ul>
<p>Причины обычно в неправильных границах (по техническим слоям или сущностям вместо контекстов) и в общих данных. Лечение — пересмотр границ: объединить сервисы, которые всегда меняются вместе (это нормальное решение, а не поражение), перейти от синхронных вызовов к событиям и локальным копиям данных (event-carried state transfer), развести общую базу по владельцам.</p>
<p>Полезная метрика: сколько сервисов затрагивает типичная фича и сколько синхронных вызовов в критическом пути запроса. Если ответ «почти все» и «пять», это распределённый монолит.</p>

<h3>Владение данными: database per service</h3>
<p>Ключевое правило микросервисов — <strong>каждый сервис владеет своими данными</strong>, и никто другой не обращается к его базе напрямую. Это может быть отдельный сервер, отдельная база или отдельная схема с отдельными правами — важна не физика, а то, что доступ к данным идёт только через API сервиса.</p>
<p>Почему это важно: общая база — самая сильная связь между сервисами. Схема становится публичным контрактом, который нельзя менять без согласования со всеми читателями; один сервис может положить базу тяжёлым запросом; транзакции соседа держат ваши блокировки.</p>
<p>Следствия, с которыми надо уметь работать:</p>
<ul>
<li><strong>Запросы через несколько сервисов</strong>: API composition (агрегатор собирает ответ из нескольких сервисов — просто, но синхронно и медленно) или CQRS-представление, которое строится из событий нескольких сервисов.</li>
<li><strong>Согласованность между сервисами</strong> — саги вместо транзакций, outbox для надёжной публикации, идемпотентные потребители.</li>
<li><strong>Дублирование данных</strong>: сервис заказов хранит копию имени клиента для отображения. Это нормально, если ясно, кто источник истины и как копия обновляется.</li>
<li><strong>Отчётность</strong> — отдельное аналитическое хранилище (DWH, ClickHouse), куда данные приходят через CDC или события, а не прямые запросы в базы сервисов.</li>
</ul>
<p>Переход от общей legacy-базы к раздельным — самая трудная часть любой миграции. Типичный путь: сначала логическое разделение (новый сервис пишет в свои таблицы, старые читаются через ACL), затем синхронизация через CDC, затем перенос владения.</p>

<h3>Способы взаимодействия</h3>
<p><strong>Синхронное</strong> (REST/HTTP, gRPC): запрос — ответ, клиент ждёт. Подходит, когда нужен ответ прямо сейчас (проверка, чтение для UI). Минусы — временная связанность: если вызываемый сервис недоступен, недоступен и вызывающий; задержки складываются по цепочке. Обязательны таймауты, ретраи с backoff, circuit breaker. gRPC даёт строгий контракт (Protobuf), HTTP/2, стриминг и меньший размер сообщений — хорош для внутренних вызовов; REST проще для внешних клиентов и отладки.</p>
<p><strong>Асинхронное</strong> (Kafka, RabbitMQ): отправитель публикует событие или команду и не ждёт. Сервисы развязаны во времени: потребитель может быть недоступен, сообщения подождут. Минусы — eventual consistency, сложнее отладка и трассировка, нужна идемпотентность, порядок и обработка ошибок (DLQ).</p>
<table>
<thead><tr><th>Вопрос</th><th>Синхронно</th><th>Асинхронно</th></tr></thead>
<tbody>
<tr><td>Нужен ответ сейчас?</td><td>Да</td><td>Нет</td></tr>
<tr><td>Отказ получателя</td><td>Отказ отправителя</td><td>Сообщение ждёт</td></tr>
<tr><td>Согласованность</td><td>Сразу (для одного вызова)</td><td>В конечном счёте</td></tr>
<tr><td>Связанность</td><td>Временная и по API</td><td>По контракту события</td></tr>
<tr><td>Типичное</td><td>Запросы UI, проверки</td><td>Уведомления о фактах, длинные процессы</td></tr>
</tbody>
</table>
<p>Хорошее правило: команды, которые меняют состояние другого контекста, и уведомления о фактах — асинхронно; чтение, нужное для ответа пользователю, — синхронно или из локальной копии. Разница между событием и командой в сообщении: событие («заказ подтверждён») — факт, у него много подписчиков и отправитель не знает, кто они; команда («зарезервируй товар») — просьба к конкретному получателю.</p>

<h3>API Gateway и BFF</h3>
<p><strong>API Gateway</strong> — единая точка входа для внешних клиентов перед набором сервисов. Обязанности: маршрутизация, терминирование TLS, аутентификация (проверка токена), rate limiting, кэширование, сбор метрик, иногда агрегация запросов. В .NET — YARP (Microsoft reverse proxy), Ocelot; вне .NET — nginx, Envoy, Kong, облачные шлюзы.</p>
<p><strong>Backend for Frontend (BFF)</strong> — отдельный шлюз для каждого типа клиента: мобильный BFF отдаёт компактные ответы, подогнанные под экраны приложения, веб-BFF — другие; партнёрский API — третий, стабильный и версионируемый. Идею популяризировали в SoundCloud и Сэм Ньюман. Важно, что BFF принадлежит команде фронтенда, и она может менять его в своём темпе. Вариант BFF для браузерного SPA — держать токены на сервере (cookie-сессия у BFF), не отдавая их в JavaScript.</p>
<p>Риски: шлюз превращается в монолит со всей бизнес-логикой («умный шлюз»); единая точка отказа и узкое место; ещё один сетевой хоп. Правило — в шлюзе только сквозная функциональность и композиция, бизнес-правила — в сервисах.</p>

<h3>Версионирование контрактов</h3>
<p>Как только сервис имеет потребителей, его API и события — контракт, который нельзя менять произвольно. Принципы:</p>
<ul>
<li><strong>Обратно совместимые изменения</strong> — добавить необязательное поле, новый endpoint, новое значение (если клиенты готовы к неизвестным значениям) — делаются без новой версии.</li>
<li><strong>Ломающие изменения</strong> — удалить или переименовать поле, изменить тип или смысл, сделать поле обязательным — требуют новой версии и периода поддержки обеих.</li>
<li><strong>Tolerant reader</strong> на стороне потребителя: игнорировать неизвестные поля, не падать на новых значениях enum.</li>
<li><strong>Способы версионирования HTTP API</strong>: в пути (<code>/v1/</code>, <code>/v2/</code> — самый наглядный), в заголовке или в media type. Для событий — версия в типе или заголовке и схема в Schema Registry с режимом совместимости (backward, forward, full).</li>
<li><strong>Consumer-driven contract tests</strong> (Pact): потребители описывают, что они используют, и поставщик проверяет, что не ломает их, до релиза.</li>
<li><strong>Expand and contract</strong> (parallel change): сначала добавить новое рядом со старым, перевести потребителей, затем удалить старое. Тот же приём применяется к схеме базы при деплое без простоя.</li>
</ul>
<p>Сгенерированный OpenAPI-документ — тоже контракт, и его стоит проверять в CI на ломающие изменения (diff между версиями документа).</p>

<h3>Миграция: Strangler Fig</h3>
<p>Фаулер описал <strong>Strangler Fig Application</strong> (по образу фикуса-душителя, который обрастает дерево-хозяина и постепенно его заменяет): вместо переписывания системы с нуля новая система вырастает вокруг старой и забирает функциональность по кусочку, пока старую нельзя будет выключить. Переписывание «большим взрывом» почти всегда проваливается: годы без выпуска ценности, а старая система продолжает меняться.</p>
<p>Механика:</p>
<ol>
<li><strong>Перехват</strong>: перед старой системой ставится фасад/прокси (API gateway, YARP), через который идут все запросы.</li>
<li><strong>Выделение</strong> одного кусочка — лучше с ясной границей и ощутимой ценностью; новая реализация пишется рядом.</li>
<li><strong>Переключение</strong> трафика для этого кусочка на новую систему — постепенно, с feature flag или процентом трафика, с возможностью откатиться.</li>
<li><strong>Синхронизация данных</strong> между старой и новой системами на переходный период: CDC (Debezium) из legacy-базы, события, двунаправленная синхронизация (самое сложное).</li>
<li><strong>Удаление</strong> старого кода, когда трафик полностью переключён.</li>
</ol>
<p>Для legacy с большой базой и тысячами хранимых процедур полезны: Anti-Corruption Layer, чтобы новая модель не заражалась старой; Branch by Abstraction внутри кода (сначала абстракция над старой реализацией, потом новая реализация за той же абстракцией); параллельный запуск (shadow traffic) со сравнением результатов старой и новой реализаций перед переключением.</p>

<h3>Закон Конвея и Team Topologies</h3>
<p><strong>Закон Конвея</strong> (Мелвин Конвей, 1968): организации, проектирующие системы, создают структуры, повторяющие структуру коммуникаций этих организаций. Пример из самой статьи: из восьми человек пятеро делали компилятор COBOL, трое — ALGOL, и компилятор COBOL вышел из пяти фаз, а ALGOL — из трёх; популярная шутливая версия Эрика Рэймонда — «четыре группы делают компилятор — получится четырёхпроходный компилятор». Следствие: архитектура и структура команд неразделимы. Микросервисы, нарезанные поперёк команд, будут постоянно требовать координации, а одна команда, владеющая пятнадцатью сервисами, получит распределённую систему без выгоды независимости.</p>
<p><strong>Inverse Conway Maneuver</strong> — сознательно выстраивать структуру команд под желаемую архитектуру: хотите независимые контексты — сделайте независимые команды, владеющие ими целиком.</p>
<p>Книга «Team Topologies» (Мэтью Скелтон и Мануэль Паис, 2019) описывает четыре типа команд:</p>
<ul>
<li><strong>Stream-aligned</strong> — команда, выровненная по потоку ценности (продукт, сценарий, клиентский сегмент); основной тип.</li>
<li><strong>Platform</strong> — даёт внутреннюю платформу как продукт (CI/CD, Kubernetes, наблюдаемость, SDK), снижая когнитивную нагрузку stream-aligned команд.</li>
<li><strong>Enabling</strong> — помогает другим командам освоить новые практики и уходит.</li>
<li><strong>Complicated-subsystem</strong> — владеет частью, требующей глубокой экспертизы (движок расчётов, оптимизация маршрутов).</li>
</ul>
<p>и три режима взаимодействия: collaboration, X-as-a-Service, facilitating. Центральная идея — <strong>когнитивная нагрузка</strong> команды как ограничение: команда не должна владеть большим, чем способна понимать. Если в резюме есть внутренние SDK, это хороший мостик к разговору о платформенной команде и X-as-a-Service.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Монолит или микросервисы для нового проекта?»</summary>
<p>Для нового продукта с одной-двумя командами и неясными границами я бы начал с модульного монолита: один деплой, одна база с отдельной схемой на модуль, модули по bounded contexts, общение через публичные контракты и события, границы проверены архитектурными тестами. Это даёт скорость, ACID-транзакции и дешёвые исправления неправильных границ. Микросервисы окупаются при нескольких независимых командах, разных требованиях к масштабированию или изоляции отказов, и за них платят сетью, сагами, eventual consistency, версионированием контрактов, трассировкой и платформой. Модуль, который владеет своими данными и общается событиями, позже выносится в сервис почти механически. Так что я бы спросил о команде, сроках и ожидаемой нагрузке и только после этого выбирал.</p>
</details>
<details><summary>«Что такое распределённый монолит и как его распознать?»</summary>
<p>Это система, разрезанная на сервисы, но сохранившая связанность монолита: сервисы нельзя релизить независимо, они делят базу, общаются длинными синхронными цепочками и падают вместе. Распознаю по тому, сколько сервисов затрагивает типичная фича, требуются ли синхронные релизы, есть ли общая база или общая библиотека доменных моделей, и сколько синхронных вызовов в критическом пути. Обычно причина — разрез по сущностям или техническим слоям вместо bounded contexts. Лечение — пересмотреть границы, объединить сервисы, которые всегда меняются вместе, перейти от синхронных вызовов к событиям и локальным копиям данных, развести данные по владельцам. Объединить два сервиса в один — нормальное инженерное решение, а не провал.</p>
</details>
<details><summary>«Почему у каждого сервиса должна быть своя база? Как тогда делать запросы через несколько сервисов?»</summary>
<p>Общая база — самая сильная связь: схема становится контрактом для всех читателей, её нельзя менять без согласования, а тяжёлые запросы и блокировки одного сервиса бьют по другим. Поэтому сервис владеет своими данными и отдаёт их только через API или события; физически это может быть даже один кластер с разными схемами и правами. Запросы через несколько сервисов решаются либо API composition — агрегатор собирает ответ, просто, но синхронно и медленнее, — либо read model, которая строится из событий нескольких сервисов и отвечает одним запросом. Согласованность — саги и outbox. Отчётность — в отдельном аналитическом хранилище через CDC, а не прямыми запросами в базы сервисов.</p>
</details>
<details><summary>«Как бы вы мигрировали legacy-монолит с большой базой на сервисы?»</summary>
<p>Только постепенно, через Strangler Fig: перед старой системой ставлю фасад или прокси, выбираю кусок с ясной границей и ощутимой ценностью, пишу его в новом сервисе и переключаю трафик постепенно, с возможностью отката. Самое трудное — данные: на переходный период нужна синхронизация, обычно CDC из legacy-базы через Debezium в Kafka, а новый сервис защищает свою модель anti-corruption layer-ом от старых таблиц и процедур. Для логики, спрятанной в тысячах хранимых процедур, помогает параллельный запуск: новая реализация считает тот же результат, что и старая, результаты сравниваются, и переключение происходит, когда расхождений нет. Переписывать всё с нуля я бы не стал — это годы без ценности и погоня за движущейся целью.</p>
</details>
<details><summary>«Когда синхронное взаимодействие, а когда асинхронное?»</summary>
<p>Синхронно — когда ответ нужен прямо сейчас для ответа пользователю: проверка, чтение данных для экрана. Цена — временная связанность: недоступен вызываемый, недоступен и вызывающий, и задержки складываются, поэтому обязательны таймауты, ретраи и circuit breaker. Асинхронно — для фактов, о которых надо уведомить других, и для изменений состояния в других контекстах, длинных процессов и всего, что может подождать: сервисы развязаны во времени, но появляется eventual consistency, идемпотентность и отладка через трассировку. Я стараюсь, чтобы критический путь пользовательского запроса не содержал синхронных вызовов в другие сервисы для записи; данные, нужные для чтения, часто лучше держать локальной копией, обновляемой событиями.</p>
</details>
<details><summary>«Как версионировать API, чтобы не ломать клиентов?»</summary>
<p>Большинство изменений делаю обратно совместимыми: только добавляю необязательные поля и новые endpoint-ы, ничего не переименовываю и не меняю смысл, а клиенты следуют принципу tolerant reader и игнорируют незнакомое. Ломающие изменения — через новую версию, обычно в пути, с периодом параллельной поддержки и метриками использования старой версии, чтобы знать, когда её можно убрать. Для событий — схемы в Schema Registry с режимом совместимости. Технически помогает expand and contract: добавить новое рядом, перевести потребителей, удалить старое. В CI проверяю diff OpenAPI-документа на ломающие изменения, а для внутренних сервисов хороши consumer-driven contract tests вроде Pact.</p>
</details>
<details><summary>«Что такое закон Конвея и как он влияет на архитектуру?»</summary>
<p>Закон Конвея говорит, что структура системы повторяет структуру коммуникаций организации, которая её создаёт. Следствие: границы сервисов, нарезанные поперёк команд, постоянно требуют координации, и система будет тянуться к форме организации, хотите вы этого или нет. Поэтому границы контекстов и команд проектируют вместе, а inverse Conway maneuver — сознательно перестраивать команды под желаемую архитектуру. В Team Topologies это stream-aligned команды, владеющие потоком ценности целиком, платформенная команда, дающая инфраструктуру как сервис, enabling- и complicated-subsystem-команды, и главный критерий — когнитивная нагрузка: команда не должна владеть большим, чем может понимать. На примере внутренних SDK — это классическая модель X-as-a-Service между платформенной и продуктовыми командами.</p>
</details>
`
    },
    {
      id: 'decisions',
      title: 'Принятие архитектурных решений',
      html: `
<h3>Что такое архитектурное решение</h3>
<p>Архитектурное решение — решение, которое дорого изменить потом и которое влияет на качества системы целиком: выбор хранилища, способ взаимодействия сервисов, границы модулей, модель многоарендности, формат публичного API, стратегия обработки ошибок. Грэди Буч сформулировал это так: архитектура — это значимые проектные решения, а значимость измеряется стоимостью изменения. Выбор имени переменной — не архитектура; выбор между одной базой с row-level security и базой на тенанта — архитектура.</p>
<p>Senior-разработчика отличает не то, что он знает «правильные» решения, а то, что он умеет:</p>
<ul>
<li>увидеть, что решение — архитектурное (необратимое или дорогое для отмены), и не принимать его мимоходом;</li>
<li>сформулировать требования, из которых оно вытекает, включая нефункциональные;</li>
<li>рассмотреть альтернативы и назвать цену каждой;</li>
<li>записать решение так, чтобы через год было понятно, почему оно принято;</li>
<li>пересмотреть его, когда изменились условия, не считая это поражением.</li>
</ul>
<p>Джефф Безос популяризировал различие между дверьми с односторонним и двусторонним проходом: обратимые решения принимайте быстро и малой группой, необратимые — медленно и тщательно. Это хорошая рамка: большинство решений обратимы, и тратить на них недели — ошибка, а на необратимые (схема публичного API, модель данных, ключ шардирования) стоит потратить время.</p>

<h3>Architecture Decision Records</h3>
<p><strong>ADR (Architecture Decision Record)</strong> — короткий документ, фиксирующий одно архитектурное решение. Формат предложил Майкл Найгард в статье «Documenting Architecture Decisions» (2011). Его структура:</p>
<ul>
<li><strong>Title</strong> — короткое имя решения: «ADR-012: Тенантная изоляция через row-level security».</li>
<li><strong>Status</strong> — proposed, accepted, deprecated, superseded by ADR-NNN.</li>
<li><strong>Context</strong> — силы, которые действуют: требования, ограничения, факты. Нейтрально, без решения.</li>
<li><strong>Decision</strong> — что решили, в активном залоге: «Мы будем…».</li>
<li><strong>Consequences</strong> — что станет проще и что сложнее, включая негативные последствия.</li>
</ul>
<pre><code># ADR-007: Ошибки бизнес-логики возвращаются как Result, а не исключения

Status: Accepted (2025-03-14)

## Context
- Хендлеры возвращают отказы с кодами и аргументами, клиенту нужны стабильные коды и перевод.
- Ожидаемые отказы составляют ~15% ответов на пиковых сценариях; исключения шумят в APM.
- В C# нет checked exceptions — по сигнатуре не видно, что операция может отказать.

## Decision
Ожидаемые доменные отказы возвращаются как Result&lt;T&gt; с ErrorCode и аргументами.
Исключения — только для нарушений контракта, багов и инфраструктурных сбоев.
Перевод Result в ProblemDetails — в одном месте, ApiControllerBase.FromResult.

## Consequences
+ Отказы видны в сигнатурах, не теряются, не создают шума в мониторинге.
+ Коды ошибок — контракт; переводы проверяются тестом.
− Многословность: ранний возврат после каждого вызова.
− Риск завернуть баг в Result — ревью следит.</code></pre>
<p>Практики: ADR лежат в репозитории рядом с кодом (<code>docs/adr/</code>), в Markdown, нумеруются и <strong>не редактируются задним числом</strong> — новое решение пишется новым ADR, а старое помечается superseded. Популярные шаблоны — Nygard, MADR (Markdown Any Decision Records), Y-statements. Ценность ADR не в бюрократии, а в ответе на вопрос «почему так» через год, новому человеку в команде, и в том, что запись решения заставляет явно назвать альтернативы и цену.</p>
<p>Что писать в ADR, а что нет: решения, которые трудно отменить, влияют на несколько команд или противоречат очевидному («почему здесь не используется ORM»). Не стоит — выбор библиотеки для форматирования дат.</p>

<h3>Атрибуты качества (нефункциональные требования)</h3>
<p>Функциональные требования говорят, <em>что</em> система делает; атрибуты качества — <em>насколько хорошо</em>. Именно они определяют архитектуру: одну и ту же функциональность можно сделать монолитом на одной базе или распределённой системой в трёх регионах, и выбор диктуют нефункциональные требования. Стандарт ISO/IEC 25010 описывает модель качества; на практике чаще всего обсуждают:</p>
<ul>
<li><strong>Производительность</strong>: задержка (p50, p95, p99), пропускная способность.</li>
<li><strong>Масштабируемость</strong>: как система ведёт себя при росте нагрузки и данных.</li>
<li><strong>Доступность</strong>: доля времени, когда система работает (SLO 99.9% ≈ 43 минуты простоя в месяц).</li>
<li><strong>Надёжность и отказоустойчивость</strong>: что происходит при сбоях компонентов, RPO/RTO.</li>
<li><strong>Согласованность</strong>: строгая или eventual, где какая допустима.</li>
<li><strong>Безопасность</strong>: аутентификация, авторизация, изоляция тенантов, аудит, защита данных.</li>
<li><strong>Сопровождаемость (maintainability)</strong>: насколько легко менять систему; тестируемость, модульность.</li>
<li><strong>Наблюдаемость</strong>: логи, метрики, трассировка.</li>
<li><strong>Развёртываемость</strong>: частота и безопасность релизов.</li>
<li><strong>Стоимость</strong>: инфраструктура и разработка.</li>
</ul>
<p>Главная проблема — атрибуты формулируют расплывчато: «система должна быть быстрой». Требование становится полезным, когда его можно проверить. SEI предлагает формулировать <strong>сценарии атрибутов качества</strong>: источник, стимул, артефакт, среда, реакция, мера. Например: «при пиковой нагрузке 500 RPS запрос списка заказов отвечает за 300 мс на p95» или «при падении одной ноды базы система продолжает принимать заказы, потеря данных — не более 1 секунды».</p>
<p>Атрибуты конфликтуют между собой: согласованность против доступности при разделении сети (CAP), производительность против сопровождаемости (денормализация), безопасность против удобства. Поэтому архитектура — всегда выбор приоритетов, и задача — сделать этот выбор явным.</p>

<h3>Анализ компромиссов</h3>
<p>«Всё в архитектуре — это компромисс» — эту мысль в разных формулировках повторяют многие авторы, в частности её часто формулируют как «первый закон архитектуры» в книге «Fundamentals of Software Architecture» (Марк Ричардс и Нил Форд). На собеседовании хорошо работает структура:</p>
<ol>
<li><strong>Требования и ограничения.</strong> Что важно здесь: какие атрибуты качества в приоритете, какой масштаб, какая команда, сроки, существующие системы.</li>
<li><strong>Альтернативы.</strong> Минимум две-три, включая «ничего не делать» и самую простую.</li>
<li><strong>Оценка по критериям.</strong> Таблица альтернатив против атрибутов, а не «нравится — не нравится».</li>
<li><strong>Решение и цена.</strong> «Выбираем X, потому что важнее Y; платим Z, и вот как будем это смягчать».</li>
<li><strong>Условия пересмотра.</strong> «Если нагрузка вырастет в 10 раз / появится вторая команда — вернёмся к вопросу».</li>
</ol>
<table>
<thead><tr><th>Многоарендность</th><th>Изоляция</th><th>Стоимость</th><th>Операции</th><th>Кастомизация</th></tr></thead>
<tbody>
<tr><td>Общая база, колонка тенанта + RLS</td><td>Средняя (логическая)</td><td>Низкая</td><td>Одна миграция на всех</td><td>Низкая</td></tr>
<tr><td>Схема на тенанта</td><td>Выше</td><td>Средняя</td><td>Миграции × N схем</td><td>Средняя</td></tr>
<tr><td>База на тенанта</td><td>Высокая</td><td>Высокая</td><td>Сложные: N баз, бэкапы, пулы</td><td>Высокая</td></tr>
</tbody>
</table>
<p>Формальные методы: ATAM (Architecture Tradeoff Analysis Method, SEI) — структурированная оценка архитектуры против сценариев атрибутов качества с выявлением рисков, точек чувствительности и компромиссов. В полном виде его применяют редко, но словарь полезен. <strong>Fitness functions</strong> (книга «Building Evolutionary Architectures», Нил Форд, Ребекка Парсонс, Патрик Куа) — автоматические проверки архитектурных характеристик: архитектурные тесты на зависимости, нагрузочные тесты в CI с порогом, проверки на число запросов на endpoint. Они превращают решение из документа в инвариант, который не деградирует.</p>

<h3>Технический долг</h3>
<p>Метафору технического долга ввёл Уорд Каннингем в 1992 году: выпустить код, который отражает неполное понимание, — как взять в долг; это ускоряет сейчас, но по долгу надо платить проценты (замедление последующих изменений), и если не погашать основную сумму, проценты съедят всё. Важно: у Каннингема речь шла о <em>сознательном</em> упрощении ради обучения и скорости, с последующим рефакторингом, а не о плохом коде.</p>
<p>Мартин Фаулер предложил <strong>квадрант технического долга</strong> по двум осям:</p>
<table>
<thead><tr><th></th><th>Безрассудный (reckless)</th><th>Благоразумный (prudent)</th></tr></thead>
<tbody>
<tr><td><strong>Намеренный</strong></td><td>«Нет времени на дизайн»</td><td>«Выпускаем сейчас и разберёмся с последствиями»</td></tr>
<tr><td><strong>Ненамеренный</strong></td><td>«Что такое слои?»</td><td>«Теперь мы знаем, как надо было сделать»</td></tr>
</tbody>
</table>
<p>Управление долгом:</p>
<ul>
<li><strong>Сделать видимым</strong>: записывать долг (тикеты, ADR с «Consequences», TODO со ссылкой на задачу), чтобы он не был только в головах.</li>
<li><strong>Оценивать проценты</strong>, а не основную сумму: долг в коде, который никто не трогает, почти ничего не стоит; долг в горячей зоне, через которую идёт каждая фича, стоит дорого. Анализ hotspots — пересечение частоты изменений и сложности по истории git — хороший инструмент.</li>
<li><strong>Платить регулярно</strong>: правило бойскаута (оставь код чище, чем нашёл), рефакторинг как часть фичи, выделенная доля ёмкости на долг. «Спринт рефакторинга раз в год» обычно не работает.</li>
<li><strong>Говорить с бизнесом на его языке</strong>: не «нужен рефакторинг», а «фичи в этом модуле стоят втрое дороже и дают баги; два спринта вернут скорость» — с цифрами из истории.</li>
<li><strong>Переписывание — последнее средство</strong>, и обычно через strangler fig, а не большим взрывом.</li>
</ul>
<p>Отдельно — архитектурный долг (неверные границы, неверное хранилище) стоит гораздо дороже кодового, потому что его нельзя погасить локальным рефакторингом.</p>

<h3>Как рассказывать об архитектуре на собеседовании</h3>
<p>Вопросы вида «расскажите о самом сложном архитектурном решении» или «как устроена система на последнем проекте» — обязательная часть интервью на senior. Структура ответа, которую удобно держать в голове (вариация STAR — Situation, Task, Action, Result — с акцентом на компромиссы):</p>
<ol>
<li><strong>Контекст (30 секунд)</strong>: что за система, масштаб в цифрах (RPS, объём данных, число сервисов, команда), какую бизнес-задачу решала.</li>
<li><strong>Проблема</strong>: что было не так или какое требование появилось, и почему это было трудно. Конкретные симптомы: задержки, инциденты, скорость разработки.</li>
<li><strong>Варианты</strong>: какие альтернативы рассматривали и почему отвергли — это главное, что отличает senior.</li>
<li><strong>Решение и ваша роль</strong>: что именно сделали <em>вы</em>, а не «мы»; как убеждали команду, что пришлось согласовывать.</li>
<li><strong>Результат в цифрах</strong>: задержка, число инцидентов, скорость релизов.</li>
<li><strong>Рефлексия</strong>: что сделали бы иначе сейчас, какую цену заплатили, что не сработало.</li>
</ol>
<p>Материал для историй стоит подготовить заранее по нескольким темам: интеграция через брокер (надёжность доставки, дубли, порядок), работа с legacy (как изолировали старую базу, как переносили логику), производительность (как нашли и устранили узкое место), моделирование домена (почему модель такая, как защищены инварианты), отказ и инцидент (что сломалось, как нашли, что изменили). У каждой истории — один-два честных компромисса и одна вещь, которую вы бы сделали иначе.</p>
<blockquote><strong>Важно.</strong> Типичные ошибки: рассказывать о технологиях вместо проблем («у нас были Kafka, Redis и Kubernetes»), не называть цифры, говорить только «мы», не называть недостатков решения. Интервьюер проверяет, понимаете ли вы, <em>почему</em> система устроена так, — а лучший способ показать это — объяснить, чем пришлось заплатить.</blockquote>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Расскажите о сложном архитектурном решении, которое вы принимали»</summary>
<p>Здесь важна структура, а не конкретная история. Я начинаю с контекста в цифрах — что за система, какой масштаб, какая команда. Затем называю проблему и почему она была трудной, например dual write при публикации событий из сервиса склада в Kafka, из-за которого периодически терялись события и расходились остатки. Дальше альтернативы: публикация после коммита с ретраями, распределённая транзакция, outbox с polling, outbox с CDC, — и почему выбрали конкретный вариант, учитывая инфраструктуру и требования к задержке. Затем что именно сделал я сам, какой получился результат в метриках и какую цену заплатили: например, дополнительная таблица, мониторинг отставания и необходимость идемпотентных потребителей. И в конце — что сделал бы иначе сейчас. Без рефлексии и цены рассказ звучит заученно.</p>
</details>
<details><summary>«Что такое ADR и зачем он нужен?»</summary>
<p>Architecture Decision Record — короткий документ на одно архитектурное решение в формате, предложенном Майклом Найгардом: название, статус, контекст, решение и последствия, включая негативные. Хранится в репозитории рядом с кодом, нумеруется и не переписывается — изменённое решение оформляется новым ADR, который заменяет старый. Нужен, чтобы через год ответить на вопрос «почему здесь так», не полагаясь на память людей, которые могли уйти, и чтобы новый человек понимал ограничения, прежде чем «улучшать». Есть и эффект в момент принятия: записывая контекст и последствия, ты вынужден явно назвать альтернативы и цену. Писать ADR стоит на решения, которые дорого отменить или которые противоречат очевидному, а не на каждый выбор библиотеки.</p>
</details>
<details><summary>«Как вы работаете с нефункциональными требованиями?»</summary>
<p>Первое — выяснить их, потому что их почти никогда не формулируют сами: ожидаемая нагрузка и её профиль, допустимая задержка, требования к доступности, к согласованности, объём данных и рост, требования безопасности и регуляторики. Второе — сделать их проверяемыми: не «быстро», а «список заказов за 300 мс на p95 при 500 RPS», не «надёжно», а SLO по доступности и RPO и RTO. Третье — расставить приоритеты, потому что атрибуты конфликтуют: согласованность против доступности, производительность против простоты, и архитектура определяется тем, что важнее. Четвёртое — закрепить важное автоматическими проверками: нагрузочными тестами, алертами по SLO, архитектурными тестами, — чтобы требование не деградировало молча.</p>
</details>
<details><summary>«Как вы управляете техническим долгом?»</summary>
<p>Делаю его видимым — записываю в тикеты с описанием, чем он мешает, а осознанно взятый долг фиксирую в последствиях решения. Оцениваю не размер, а проценты: долг в коде, который никто не трогает, можно не трогать годами, а долг в горячей зоне, через которую идёт каждая фича, гашу в первую очередь; горячие зоны видны по истории изменений в git в пересечении со сложностью. Плачу регулярно, как часть обычной работы: рефакторинг в рамках фичи, которая затрагивает это место, и постоянная доля ёмкости команды, а не спринт рефакторинга раз в год. С бизнесом говорю цифрами: сколько дольше идут фичи в этом модуле и сколько из него багов. И отличаю благоразумный долг — сознательное упрощение ради срока — от безрассудного, который просто плохой код.</p>
</details>
<details><summary>«Как вы принимаете решение, если команда не согласна?»</summary>
<p>Сначала разделяю, о чём спор: о фактах, о приоритетах или о вкусах. Споры о фактах решаются данными — прототипом, нагрузочным тестом, измерением на реальных данных. Споры о приоритетах — возвратом к требованиям: что для этого продукта важнее, задержка или простота сопровождения, и тогда решение часто становится очевидным. Предлагаю записать альтернативы с компромиссами в ADR со статусом proposed и обсудить письменно — это убирает эмоции и даёт высказаться тем, кто не любит спорить на встречах. Если решение обратимое, лучше быстро выбрать и договориться о критериях пересмотра, чем тратить недели. Если необратимое — привлекаю больше людей и время. И важно, что после решения команда его поддерживает, даже если кто-то был против: disagree and commit.</p>
</details>
<details><summary>«Что бы вы сделали иначе в архитектуре своего последнего проекта?»</summary>
<p>Этот вопрос проверяет рефлексию, и ответ «ничего» — худший. Хорошая структура: назвать решение, объяснить, почему тогда оно казалось правильным с учётом известного в тот момент, рассказать, что выяснилось позже, и что бы вы сделали сейчас — и, желательно, что вы сделали, когда поняли. Например: границу сервиса провели по сущности, а не по контексту, и это вылилось в синхронные вызовы между сервисами на каждом сценарии; сейчас я бы начал с модуля в монолите и выносил после того, как граница подтвердилась. Или: публикация событий без outbox, которая давала редкие расхождения данных. Важно показать, что ошибка была разумной в своём контексте и что вы извлекли из неё принцип, а не просто сожаление.</p>
</details>
<details><summary>«Что такое fitness functions?»</summary>
<p>Термин из книги «Building Evolutionary Architectures»: автоматические проверки того, что архитектура сохраняет нужные характеристики по мере развития системы. Идея в том, что архитектурное решение, записанное только в документе, деградирует за несколько месяцев, а решение, которое проверяется в CI, становится инвариантом. Примеры: архитектурные тесты на NetArchTest или ArchUnitNET, запрещающие ссылку домена на инфраструктуру или модуля на внутренности другого модуля; тест, что каждый endpoint объявляет требуемое право; нагрузочный тест с порогом задержки; проверка числа SQL-запросов на чтение страницы, чтобы не вернулся N+1; diff OpenAPI на ломающие изменения. Это, на мой взгляд, самый практичный способ сделать архитектуру живой.</p>
</details>
`
    }
  ],
  questions: [
    {
      id: 'arch-001', chapter: 'solid', type: 'choice',
      q: `<p>Какой принцип нарушает этот код?</p>
<pre><code>public class ReadOnlyRepository : Repository
{
    public override void Save(Entity e) =&gt;
        throw new NotSupportedException();
}</code></pre>`,
      options: [`Single Responsibility Principle`, `Liskov Substitution Principle`, `Dependency Inversion Principle`, `Open/Closed Principle`],
      answer: 1,
      explain: `<p>Наследник ослабляет постусловие базового контракта: код, работающий с <code>Repository</code> и вызывающий <code>Save</code>, сломается при подстановке <code>ReadOnlyRepository</code>. Это классическое нарушение LSP. Его часто сопровождает и нарушение ISP (базовый тип слишком широкий), но «бросающий наследник» — прежде всего про подстановку. SRP здесь ни при чём: у класса нет лишних обязанностей. Лечение — выделить узкий интерфейс чтения, как в .NET сделали с <code>IReadOnlyCollection&lt;T&gt;</code>.</p>`
    },
    {
      id: 'arch-002', chapter: 'solid', type: 'choice',
      q: `<p>Application-слой содержит <code>OrderHandler</code>, который принимает в конструкторе <code>IOrderRepository</code>. Интерфейс объявлен в проекте <code>Shop.Infrastructure</code>, на который ссылается <code>Shop.Application</code>. Контейнер DI всё собирает. Что верно?</p>`,
      options: [`DIP соблюдён, потому что зависимость приходит через конструктор`, `DIP соблюдён, потому что используется интерфейс, а не класс`, `Нарушен ISP, потому что интерфейс лежит не там`, `DIP нарушен: абстракцией владеет низкоуровневый модуль, и зависимость в исходниках не инвертирована`],
      answer: 3,
      explain: `<p>DIP — про направление зависимостей и владение абстракцией. Если интерфейс лежит в инфраструктуре, Application всё равно ссылается на инфраструктурную сборку, и зависимость идёт сверху вниз — как без интерфейса. Внедрение через конструктор — это DI, техника, а не принцип; использование контейнера ничего не гарантирует. Чтобы инвертировать, интерфейс должен лежать в Application (или Domain), а Infrastructure — ссылаться на него.</p>`
    },
    {
      id: 'arch-003', chapter: 'solid', type: 'open',
      q: `<p>Чем Dependency Inversion Principle отличается от Dependency Injection и IoC-контейнера? Скажите вслух, потом сверьтесь.</p>`,
      answer: `<p>DIP — принцип дизайна: модули верхнего уровня и модули нижнего уровня зависят от абстракций, а абстракциями владеет верхний уровень. Поэтому зависимость в исходниках идёт от инфраструктуры к домену — против потока управления. Dependency Injection — техника, при которой зависимость передаётся объекту снаружи, обычно через конструктор, а не создаётся внутри. IoC-контейнер — инструмент, автоматизирующий сборку графа объектов и управление временем жизни.</p>
<p>Они ортогональны: DI без контейнера — Pure DI в Composition Root; контейнер при нарушенном DIP — интерфейс в инфраструктурной сборке, на которую ссылается домен; DIP без интерфейсов — делегат, объявленный потребителем. Отдельно стоит упомянуть Service Locator как анти-паттерн: контейнер есть, но зависимости спрятаны.</p>`
    },
    {
      id: 'arch-004', chapter: 'solid', type: 'choice',
      q: `<p>Валидация ИНН встречается в двух местах: при регистрации компании и при импорте контрагентов из Excel. Код сейчас одинаковый. Правила импорта по требованию бизнеса скоро станут мягче (принимать с предупреждением). Что правильнее с точки зрения DRY?</p>`,
      options: [`Знание о контрольной сумме ИНН вынести в одно место (value object), а решение «отказать или предупредить» оставить каждому сценарию`, `Объединить обе проверки в один метод с флагом <code>strict</code>`, `Оставить две независимые копии всего кода, раз сценарии разные`, `Перенести всю валидацию в хранимую процедуру, чтобы она была одна`],
      answer: 0,
      explain: `<p>DRY — про знание, а не про текст. Алгоритм контрольной суммы ИНН — одно знание, и у него должно быть одно авторитетное представление (например, value object <code>Inn</code>). А политика реакции на невалидный номер — разное знание для двух сценариев, и объединять её флагом значит создать управляющую связанность (control coupling): правка одного сценария рискует сломать второй. Две полные копии дублируют настоящее знание, а процедура только переносит проблему в другое место.</p>`
    },
    {
      id: 'arch-005', chapter: 'solid', type: 'open',
      q: `<p>Приведите пример нарушения ISP и объясните, как его исправить. Почему «интерфейс на каждый метод» — тоже плохо?</p>`,
      answer: `<p>Нарушение ISP — толстый интерфейс, от которого зависят клиенты, использующие лишь часть методов. Пример: <code>IOrderRepository</code> с <code>Get</code>, <code>Search</code>, <code>Add</code>, <code>Delete</code>, <code>ExportToExcel</code> и <code>RebuildIndex</code>. Отчётный сервис использует только <code>Search</code>, но мокает шесть методов, а изменение сигнатуры экспорта требует правок у всех клиентов. Исправление — role interfaces по потребностям клиентов: <code>IOrderReader</code>, <code>IOrderStore</code>, <code>IOrderExport</code>; один класс может реализовывать все три.</p>
<p>В самом .NET пример исправления — появление <code>IReadOnlyCollection&lt;T&gt;</code> и <code>IReadOnlyList&lt;T&gt;</code>, потому что <code>ICollection&lt;T&gt;</code> заставлял read-only коллекции бросать на <code>Add</code>. Обратная крайность — интерфейс на каждый метод: раздутая регистрация DI, сложная навигация, ни одной реальной группы клиентов за каждым интерфейсом. Критерий — реальные разные клиенты, а не теоретическая возможность.</p>`
    },
    {
      id: 'arch-006', chapter: 'solid', type: 'choice',
      q: `<p>Что из перечисленного лучше всего описывает SRP в формулировке Мартина из «Clean Architecture»?</p>`,
      options: [`У класса должен быть ровно один публичный метод`, `Класс не должен содержать больше 200 строк`, `Модуль должен отвечать перед одним и только одним актором — группой людей, которые хотят изменений`, `Каждый класс должен работать только с одной таблицей базы данных`],
      answer: 2,
      explain: `<p>Мартин уточнил SRP: «причина изменения» — это заинтересованная сторона, актор. Класс, который меняется по требованиям бухгалтерии и по требованиям команды хранения, имеет две ответственности, даже если у него один метод. «Один метод на класс» — частое ошибочное прочтение, которое дробит вместе меняющийся код и снижает cohesion; ограничения на строки и таблицы — эвристики размера, не определение.</p>`
    },
    {
      id: 'arch-007', chapter: 'solid', type: 'open',
      q: `<p>Почему говорят «предпочитайте композицию наследованию»? Когда наследование всё же уместно?</p>`,
      answer: `<p>Наследование — самая сильная форма связи: наследник зависит от внутренней реализации базового класса, от порядка вызова виртуальных методов и protected-состояния, поэтому изменение базы ломает наследников, которых её автор не видел (хрупкий базовый класс). Оно статично и плохо комбинируется: кэш, логирование и ретраи через наследование дают комбинаторный взрыв классов, а через декораторы собираются в любой комбинации и в рантайме.</p>
<p>Наследование уместно, когда есть настоящее «является» со стабильным контрактом и база спроектирована для расширения: иерархия исключений, <code>BackgroundService</code> как Template Method, базовый класс агрегата с механикой доменных событий. По умолчанию разумно делать классы <code>sealed</code> и открывать наследование осознанно.</p>`
    },
    {
      id: 'arch-008', chapter: 'patterns', type: 'choice',
      q: `<p>Какой паттерн здесь реализован?</p>
<pre><code>public sealed class RetryingCarrierClient(ICarrierClient inner) : ICarrierClient
{
    public async Task&lt;Label&gt; CreateLabelAsync(Shipment s, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            try { return await inner.CreateLabelAsync(s, ct); }
            catch (HttpRequestException) when (attempt &lt; 3)
            { await Task.Delay(200 * attempt, ct); }
        }
    }
}</code></pre>`,
      options: [`Adapter`, `Proxy`, `Facade`, `Decorator`],
      answer: 3,
      explain: `<p>Класс реализует тот же интерфейс, что и обёрнутый объект, и добавляет поведение (повторы), не меняя интерфейса, — это Decorator. Proxy структурно такой же, но его цель — контролировать доступ (ленивое создание, права, удалённый объект), а не добавлять обязанности. Adapter менял бы интерфейс, а Facade упрощал бы сложную подсистему.</p>`
    },
    {
      id: 'arch-009', chapter: 'patterns', type: 'choice',
      q: `<p>Как ASP.NET Core middleware соотносится с классическим Chain of Responsibility из GoF?</p>`,
      options: [`Это вариант-конвейер: каждое звено может выполнить код до и после следующего или прервать цепочку, а не только «обработать или передать»`, `Это точная реализация GoF: запрос обрабатывает ровно одно звено, остальные пропускают`, `Middleware — это Observer: все звенья получают уведомление о запросе одновременно`, `Middleware — это Template Method: <code>WebApplication</code> задаёт скелет, а middleware переопределяют шаги`],
      answer: 0,
      explain: `<p>В классическом CoR запрос передаётся по цепочке, пока какое-то звено его не обработает. Middleware — вариант «луковицы» (иногда называют Pipeline или Intercepting Filter): звено делает работу до вызова <code>next</code>, после него, или прерывает цепочку (short-circuit), как аутентификация с 401. Observer — рассылка всем подписчикам без порядка и без возможности прервать; Template Method основан на наследовании, а middleware — на композиции делегатов.</p>`
    },
    {
      id: 'arch-010', chapter: 'patterns', type: 'open',
      q: `<p>Почему Singleton часто называют анти-паттерном и чем его заменить в .NET?</p>`,
      answer: `<p>Проблема не в единственности экземпляра, а в глобальной точке доступа. Код, обращающийся к <code>Something.Instance</code>, прячет зависимость — её не видно в конструкторе; синглтон нельзя подменить в тестах; его изменяемое состояние протекает между тестами и мешает их параллельному запуску. Это глобальная переменная с красивым именем, плюс нарушение SRP: класс управляет и своей логикой, и своим временем жизни.</p>
<p>Замена — singleton lifetime в DI-контейнере: <code>services.AddSingleton&lt;IClock, SystemClock&gt;()</code>. Экземпляр один, но приходит через конструктор и подменяется. Для времени в .NET 8 есть <code>TimeProvider</code>. Надо помнить о потокобезопасности синглтона и о captive dependency: синглтон, получивший scoped-зависимость вроде <code>DbContext</code>, удерживает её навсегда; для этого есть <code>IServiceScopeFactory</code> и <code>IDbContextFactory</code>.</p>`
    },
    {
      id: 'arch-011', chapter: 'patterns', type: 'choice',
      q: `<p>Какой класс .NET — пример Abstract Factory?</p>`,
      options: [`<code>StringBuilder</code>`, `<code>Lazy&lt;T&gt;</code>`, `<code>DbProviderFactory</code>`, `<code>BackgroundService</code>`],
      answer: 2,
      explain: `<p><code>DbProviderFactory</code> создаёт <em>семейство</em> согласованных объектов одного провайдера — <code>DbConnection</code>, <code>DbCommand</code>, <code>DbParameter</code> — не раскрывая конкретных классов (SqlClient, Npgsql). Это определение Abstract Factory. <code>StringBuilder</code> — Builder, <code>Lazy&lt;T&gt;</code> — ленивая инициализация (часто используется для синглтона), <code>BackgroundService</code> — Template Method.</p>`
    },
    {
      id: 'arch-012', chapter: 'patterns', type: 'open',
      q: `<p>Где паттерн Strategy встречается в .NET и когда вы предпочтёте простой <code>switch</code>?</p>`,
      answer: `<p>В .NET Strategy повсюду: <code>IComparer&lt;T&gt;</code> и <code>IEqualityComparer&lt;T&gt;</code> (сортировка и словари не знают, как сравнивать), <code>StringComparer.OrdinalIgnoreCase</code>, <code>JsonNamingPolicy</code>, политики устойчивости Polly. В современном C# простая стратегия — это часто просто делегат <code>Func&lt;T, TResult&gt;</code>, а набор стратегий удобно получать из DI через keyed services или словарь по ключу.</p>
<p><code>switch</code> честнее, когда вариантов мало, они стабильны и логика каждого короткая. Strategy выношу, когда варианты растут, каждый тянет свои зависимости и конфигурацию, их нужно тестировать изолированно, выбирать по конфигурации, или когда один и тот же <code>switch</code> по одному enum повторяется в нескольких местах — значит, знание о вариантах размазано, и стратегия соберёт его в один класс на вариант.</p>`
    },
    {
      id: 'arch-013', chapter: 'patterns', type: 'choice',
      q: `<p>Чем Specification (Эванс и Фаулер) ценна в связке с EF Core?</p>`,
      options: [`Она заменяет репозиторий и Unit of Work`, `Одно именованное правило отдаёт <code>Expression&lt;Func&lt;T, bool&gt;&gt;</code>, которое транслируется в SQL и проверяется в памяти, и правила комбинируются через И/ИЛИ/НЕ`, `Она позволяет включить ленивую загрузку навигаций`, `Она гарантирует, что запрос будет использовать индекс`],
      answer: 1,
      explain: `<p>Спецификация инкапсулирует бизнес-правило отбора с доменным именем («просроченная аренда»). Отдавая дерево выражений, она работает и в <code>Where</code> над <code>IQueryable</code>, и в <code>IsSatisfiedBy</code> над объектом в памяти, так что правило не расходится между списком, счётчиком и проверкой. Она не заменяет UoW, не имеет отношения к ленивой загрузке и ничего не гарантирует про индексы — план запроса определяет база.</p>`
    },
    {
      id: 'arch-014', chapter: 'patterns', type: 'open',
      q: `<p>В чём разница между Decorator, Proxy и Adapter? Ответьте одной-двумя фразами на каждый.</p>`,
      answer: `<p>Decorator реализует тот же интерфейс и добавляет поведение — кэш, логирование, ретраи; декораторы складываются в цепочку (<code>GZipStream</code> поверх <code>FileStream</code>, Scrutor <code>Decorate</code>). Proxy реализует тот же интерфейс, но контролирует доступ к объекту — откладывает создание, проверяет права, представляет удалённый объект (сгенерированный gRPC-клиент, ленивые прокси EF Core). Adapter приводит чужой интерфейс к ожидаемому клиентом — например, SOAP-клиент перевозчика к нашему порту <code>IShippingLabels</code>.</p>
<p>Структурно Decorator и Proxy одинаковы, различает их намерение; Adapter отличается структурно — интерфейсы с двух сторон разные.</p>`
    },
    {
      id: 'arch-015', chapter: 'enterprise-patterns', type: 'choice',
      q: `<p>Какие паттерны PoEAA реализует <code>DbContext</code> в EF Core?</p>`,
      options: [`Active Record и Table Module`, `Только Repository`, `Unit of Work и Identity Map (а EF Core в целом — Data Mapper)`, `Transaction Script и Service Layer`],
      answer: 2,
      explain: `<p>Change tracker <code>DbContext</code> отслеживает изменения и записывает их в <code>SaveChanges</code> одной транзакцией — Unit of Work, и гарантирует один экземпляр на ключ в пределах контекста — Identity Map. EF Core целиком — Data Mapper: доменные классы не знают о базе. <code>DbSet</code> похож на Repository, LINQ — на Query Object. Active Record — противоположный подход, где объект сам себя сохраняет.</p>`
    },
    {
      id: 'arch-016', chapter: 'enterprise-patterns', type: 'open',
      q: `<p>Чем Active Record отличается от Data Mapper? Что из них EF Core и что такое Dapper в этой классификации?</p>`,
      answer: `<p>В Active Record объект оборачивает строку таблицы и сам умеет загружаться и сохраняться (<code>order.Save()</code>, <code>Order.Find(id)</code>); модель повторяет схему. Это продуктивно для CRUD (Rails, Eloquent), но связывает модель с базой, мешает тестировать и плохо ложится на поведение, не совпадающее с таблицей. В Data Mapper отдельный слой переносит данные между объектами и таблицами, объекты о базе не знают; цена — сложность маппера.</p>
<p>EF Core и NHibernate — Data Mapper. Dapper — micro-ORM: маппит результат SQL на объекты, но не отслеживает изменения и не генерирует запросы; его используют в стиле Table Data Gateway или на read-стороне CQRS, где нужен полный контроль над SQL.</p>`
    },
    {
      id: 'arch-017', chapter: 'enterprise-patterns', type: 'choice',
      q: `<p>В одном <code>DbContext</code> вы дважды загрузили заказ запросом с трекингом. Между запросами другой процесс изменил его название в базе, а вы локально — поменяли статус, не сохраняя. Что вернёт второй запрос?</p>`,
      options: [`Тот же экземпляр, что и первый; несохранённые локальные изменения остаются, а новое название из базы не перезаписывает отслеживаемые значения`, `Новый экземпляр со свежими данными из базы; локальные изменения в первом экземпляре сохранятся отдельно`, `Тот же экземпляр, но перезаписанный данными из базы — локальный статус потерян`, `Исключение <code>DbUpdateConcurrencyException</code>`],
      answer: 0,
      explain: `<p>Change tracker — это Identity Map: на ключ один экземпляр в контексте. Запрос с трекингом вернёт уже отслеживаемый объект и по умолчанию не перезапишет его значения данными из базы, поэтому свежего названия вы не увидите. Отсюда правило короткоживущего контекста. Конфликт конкурентности возникнет только при сохранении и только если настроен токен конкурентности.</p>`
    },
    {
      id: 'arch-018', chapter: 'enterprise-patterns', type: 'open',
      q: `<p>Пользователь открыл карточку контрагента, редактировал её 15 минут и нажал «Сохранить», а коллега за это время уже сохранил свои правки. Как не потерять ничьи изменения? Назовите паттерны.</p>`,
      answer: `<p>Это задача offline lock — блокировки на бизнес-транзакцию длиннее транзакции базы. По умолчанию — Optimistic Offline Lock: у записи есть версия, она уходит клиенту (например, как ETag) и возвращается при сохранении (<code>If-Match</code>). Сервер обновляет с условием на версию; если обновилось ноль строк — конфликт 409/412, и клиент показывает разницу, предлагает слить или перезагрузить. В EF Core — токен конкурентности (<code>xmin</code> в PostgreSQL, <code>rowversion</code> в SQL Server) и <code>DbUpdateConcurrencyException</code>.</p>
<p>Если конфликты частые и потеря работы дорога — Pessimistic Offline Lock: таблица блокировок с владельцем и сроком истечения, с принудительным снятием. Держать транзакцию базы или <code>SELECT FOR UPDATE</code> открытым на время работы человека нельзя.</p>`
    },
    {
      id: 'arch-019', chapter: 'enterprise-patterns', type: 'choice',
      q: `<p>Сервис отдаёт список из 100 заказов, и для каждого DTO читает <code>order.Customer.Name</code>. Включены <code>UseLazyLoadingProxies()</code>. Сколько запросов к базе и как называется проблема?</p>`,
      options: [`1 запрос; ленивые прокси автоматически делают JOIN`, `2 запроса; это cartesian explosion`, `100 запросов; это проблема Identity Map`, `Около 101 запроса; это N+1`],
      answer: 3,
      explain: `<p>Один запрос за заказами и по одному на каждого клиента при первом обращении к навигации — N+1 (идентичные клиенты, уже загруженные в контекст, повторно не запрашиваются, но в худшем случае это 101). Лечение — проекция в <code>Select</code> с нужными полями, <code>Include</code> или выключение ленивой загрузки. Cartesian explosion — другая проблема: несколько <code>Include</code> коллекций в одном запросе, лечится <code>AsSplitQuery</code>.</p>`
    },
    {
      id: 'arch-020', chapter: 'enterprise-patterns', type: 'open',
      q: `<p>Transaction Script, Domain Model, Table Module: что это и как выбрать между первыми двумя?</p>`,
      answer: `<p>Это три способа организации бизнес-логики из PoEAA. Transaction Script — процедура на операцию: прочитать, проверить, посчитать, записать (хранимая процедура, хендлер с прямым <code>DbContext</code>). Domain Model — объектная модель, где данные и поведение вместе, правила живут в объектах. Table Module — класс на таблицу, работающий с набором записей; Фаулер связывал его с <code>DataSet</code> в .NET, сегодня он почти не встречается.</p>
<p>Transaction Script дешевле на старте и прекрасен для простой логики, отчётов и интеграций, но при росте правил дублирует проверки, и одно правило оказывается в пяти местах. Domain Model дороже вначале, но стоимость изменений растёт медленнее. Выбор — по сложности и изменчивости правил, и его можно делать по фичам внутри одной системы.</p>`
    },
    {
      id: 'arch-021', chapter: 'clean', type: 'choice',
      q: `<p>Что гласит Dependency Rule в Clean Architecture?</p>`,
      options: [`Каждый слой может вызывать только слой непосредственно под ним`, `Зависимости в исходном коде указывают только внутрь, к политикам высокого уровня; внутренние круги ничего не знают о внешних`, `Поток управления всегда идёт снаружи внутрь`, `Доменный слой должен зависеть от абстракций инфраструктуры`],
      answer: 1,
      explain: `<p>Правило — о зависимостях в исходниках, а не о потоке управления: use case вызывает репозиторий (управление идёт наружу), но интерфейс объявлен внутри, а реализация снаружи. «Только слой под ним» — описание классической слоёной архитектуры, где бизнес-логика зависит от доступа к данным. Домен не должен зависеть даже от абстракций инфраструктуры — он сам объявляет нужные ему порты.</p>`
    },
    {
      id: 'arch-022', chapter: 'clean', type: 'open',
      q: `<p>Нужен ли свой репозиторий поверх EF Core? Дайте сбалансированный ответ.</p>`,
      answer: `<p>Generic-репозиторий поверх EF — почти всегда нет: <code>DbContext</code> уже Unit of Work, <code>DbSet</code> уже репозиторий, а обёртка с <code>GetAll</code> и <code>Find(Expression)</code> теряет <code>Include</code>, проекции, <code>AsNoTracking</code>, <code>ExecuteUpdate</code>; аргумент «сменим ORM» на практике не срабатывает, а возврат <code>IQueryable</code> из репозитория ничего не инкапсулирует.</p>
<p>Репозиторий агрегата — разумен при богатой модели: узкий интерфейс на языке домена, который всегда загружает агрегат целиком, чтобы никто не забыл <code>Include</code> и не проверил инвариант по половине данных. На чтение — никаких репозиториев: проекции в DTO через EF или Dapper. Тестировать доступ к данным — на настоящей базе в Testcontainers, а не на InMemory-провайдере.</p>`
    },
    {
      id: 'arch-023', chapter: 'clean', type: 'choice',
      q: `<p>Команда делает внутренний сервис, который читает события из одного топика Kafka, обогащает их справочником и пишет в другой топик. Какая архитектура разумнее всего?</p>`,
      options: [`Clean Architecture с четырьмя проектами, репозиториями и Unit of Work`, `Hexagonal с отдельными портами на каждый топик и доменной моделью событий`, `Полноценный DDD с агрегатами и доменными событиями`, `Минимальная структура: консьюмер, функция преобразования, продюсер; без лишних слоёв`],
      answer: 3,
      explain: `<p>В таком сервисе почти нет бизнес-правил и инвариантов: это транслятор. Слои добавили бы маппинг и интерфейсы с одной реализацией без пользы. Многослойная архитектура окупается при сложных правилах, долгой жизни и нескольких входах в одни сценарии. Чистую функцию преобразования всё равно стоит выделить, чтобы тестировать её без Kafka, — но это не требует четырёх проектов.</p>`
    },
    {
      id: 'arch-024', chapter: 'clean', type: 'open',
      q: `<p>Что такое vertical slice architecture и противоречит ли она Clean Architecture?</p>`,
      answer: `<p>Vertical slice (популяризировал Джимми Богард) — организация кода по фичам: endpoint, команда, хендлер, валидатор и DTO одного use case лежат рядом, связанность между срезами минимальна, внутри среза — максимальна. Каждый срез сам выбирает сложность: CRUD пишет в <code>DbContext</code> напрямую, сложный сценарий работает через доменную модель. Добавление фичи — добавление файлов, а не правка общих сервисов.</p>
<p>Противоречия нет, если понимать, что они отвечают на разные вопросы: Clean Architecture — о направлении зависимостей между ядром и инфраструктурой, слайсы — об организации прикладного слоя. Доменная модель остаётся общей. Главный риск слайсов — дублирование бизнес-правил между ними, и лечится оно переносом правил в доменные объекты, а не в общий хелпер.</p>`
    },
    {
      id: 'arch-025', chapter: 'clean', type: 'choice',
      q: `<p>Почему для тестов доступа к данным не рекомендуют EF Core InMemory-провайдер?</p>`,
      options: [`Он не проверяет транзакции, констрейнты и трансляцию запросов в SQL, поэтому тесты проходят там, где реальная база упадёт`, `Он слишком медленный по сравнению с реальной базой`, `Он не поддерживает асинхронные методы`, `Он требует Docker`],
      answer: 0,
      explain: `<p>InMemory — не реляционная база: нет транзакций в полном смысле, нет уникальных индексов и внешних ключей как ограничений, LINQ выполняется в памяти, а не транслируется в SQL, поэтому непереводимый запрос в тесте пройдёт. Microsoft сама не рекомендует его для тестирования. Альтернатива — настоящий PostgreSQL в Testcontainers (Docker нужен как раз ему) или хотя бы SQLite in-memory для реляционного поведения.</p>`
    },
    {
      id: 'arch-026', chapter: 'clean', type: 'open',
      q: `<p>Где в Clean Architecture место EF Core? Опишите строгую и прагматичную позиции.</p>`,
      answer: `<p>Формально EF Core — инфраструктура, внешний круг. Домен на него не ссылается: никаких атрибутов, маппинг в <code>IEntityTypeConfiguration</code> в Infrastructure, приватные сеттеры и backing fields, owned/complex types и <code>HasConversion</code> для value objects.</p>
<p>Строгая позиция: Application знает только свои порты (<code>IOrderRepository</code>, <code>IUnitOfWork</code>), EF видит только Infrastructure. Прагматичная (так устроены многие популярные шаблоны): Application объявляет <code>IApplicationDbContext</code> с <code>DbSet</code>, и хендлеры пишут LINQ напрямую — ценой зависимости Application от пакета EF, но без слоя репозиториев. Частый компромисс: домен изолирован, чтение идёт через EF или Dapper напрямую, запись — через загрузку и сохранение агрегатов.</p>`
    },
    {
      id: 'arch-027', chapter: 'ddd-tactical', type: 'choice',
      q: `<p>Какое утверждение о Value Object верно?</p>`,
      options: [`Value Object имеет идентификатор, но не имеет поведения`, `Value Object можно изменять, если изменения проходят валидацию`, `Value Object неизменяем, сравнивается по значению всех компонентов и не может существовать в невалидном состоянии`, `Value Object — это DTO для передачи данных между слоями`],
      answer: 2,
      explain: `<p>Value Object определяется только значениями: две суммы «100 RUB» взаимозаменяемы, поэтому равенство — по значению, а изменение — это новое значение (неизменяемость). Он самовалидируется при создании и может содержать доменное поведение (<code>Money.Add</code>, <code>Period.Overlaps</code>). Идентичность — признак Entity, а DTO — объект транспорта без поведения и инвариантов.</p>`
    },
    {
      id: 'arch-028', chapter: 'ddd-tactical', type: 'open',
      q: `<p>Как определить границы агрегата? Назовите правила Вернона и приведите случай, когда инвариант не ложится в агрегат.</p>`,
      answer: `<p>Граница агрегата — граница транзакционной консистентности: в него входит то, что должно быть согласовано немедленно, а не то, что «связано по смыслу». Правила Вернона из «Effective Aggregate Design»: моделируйте истинные инварианты внутри границы; проектируйте маленькие агрегаты; ссылайтесь на другие агрегаты по идентификатору; за пределами границы используйте eventual consistency.</p>
<p>Проверочные вопросы: должны ли два пользователя, меняющие разные части, получать конфликт друг с другом; сколько данных загружается ради одной операции. Пример инварианта вне агрегата: «одна единица оборудования не забронирована двумя заказами на пересекающийся период» охватывает много заказов. Делать гигантский агрегат нельзя, поэтому его гарантирует база — exclusion constraint или сериализация через блокировку по продукту, — а код проверяет заранее ради понятной ошибки.</p>`
    },
    {
      id: 'arch-029', chapter: 'ddd-tactical', type: 'choice',
      q: `<p>Какое нарушение DDD в этом коде?</p>
<pre><code>public async Task Handle(CompleteOrder cmd, CancellationToken ct)
{
    var order = await db.Orders.FindAsync(cmd.OrderId);
    if (order.Lines.Any(l =&gt; l.Out &gt; l.Returned))
        throw new InvalidOperationException("Не всё вернули");
    order.State = OrderState.Finished;
    order.FinishedAt = DateTime.UtcNow;
    await db.SaveChangesAsync(ct);
}</code></pre>`,
      options: [`Нарушен SRP: хендлер не должен вызывать SaveChanges`, `Анемичная модель: правило перехода и побочные поля живут в хендлере, а не в методе агрегата, и любой другой код может выставить состояние в обход проверки`, `Нарушен принцип ссылок по идентификатору между агрегатами`, `Ошибок нет: хендлер — правильное место для бизнес-правил`],
      answer: 1,
      explain: `<p>Публичный сеттер <code>State</code> и правило «завершить можно, только если всё вернулось» в хендлере — признаки анемичной модели. Второй хендлер (или консьюмер) переведёт заказ в <code>Finished</code>, не проверив правило и забыв <code>FinishedAt</code>. Правильно — <code>order.Finish(now)</code>, возвращающий Result с доменной ошибкой. Вызов <code>SaveChanges</code> из хендлера как раз нормален: он координирует. Плюс исключение для ожидаемого бизнес-отказа — ещё один запах.</p>`
    },
    {
      id: 'arch-030', chapter: 'ddd-tactical', type: 'open',
      q: `<p>Чем доменный сервис отличается от прикладного (application service)? Приведите пример каждого.</p>`,
      answer: `<p>Прикладной сервис — по сути хендлер use case — координирует: загружает агрегаты, вызывает их методы, сохраняет, публикует события, управляет транзакцией и авторизацией. Бизнес-правил в нём нет. Пример: <code>ConfirmOrderHandler</code>, который загружает заказ, вызывает <code>order.Confirm()</code> и сохраняет.</p>
<p>Доменный сервис содержит бизнес-логику, которая естественно не принадлежит одной сущности: обычно оперирует несколькими агрегатами, назван глаголом языка домена, выражен доменными типами и не имеет состояния. Пример: расчёт доступности по множеству единиц и броней или перевод денег между двумя счетами. Если в хендлере появляются условия с бизнес-смыслом — логика утекает из домена; если всё поведение в доменных сервисах — модель снова анемична.</p>`
    },
    {
      id: 'arch-031', chapter: 'ddd-tactical', type: 'choice',
      q: `<p>Вы публикуете интеграционное событие в Kafka при подтверждении заказа. Какой способ надёжен?</p>`,
      options: [`Публиковать в Kafka до <code>SaveChanges</code>, чтобы событие точно ушло`, `Публиковать после <code>SaveChanges</code> с тремя ретраями`, `Обернуть <code>SaveChanges</code> и <code>ProduceAsync</code> в <code>TransactionScope</code>`, `Записать событие в таблицу outbox в той же транзакции, а публиковать отдельным процессом; потребители идемпотентны`],
      answer: 3,
      explain: `<p>До коммита — событие уйдёт даже при откате; после коммита — падение процесса между шагами потеряет событие, и ретраи внутри умершего процесса не помогут. Kafka не участвует в распределённых транзакциях с PostgreSQL, поэтому <code>TransactionScope</code> ничего не даст. Outbox делает событие частью локальной транзакции и даёт at-least-once, отсюда требование идемпотентности потребителей.</p>`
    },
    {
      id: 'arch-032', chapter: 'ddd-tactical', type: 'open',
      q: `<p>Анемичная модель — всегда плохо?</p>`,
      answer: `<p>Нет. Фаулер назвал Anemic Domain Model анти-паттерном для систем, где есть настоящая доменная логика: при публичных сеттерах и логике в сервисах инварианты никто не защищает, правила дублируются по хендлерам, и любое место может перевести объект в недопустимое состояние. Богатая модель прячет состояние за методами с доменными именами, и каждый метод проверяет правила.</p>
<p>Но для CRUD-справочника, где «правила» — это валидация полей, богатая модель — лишняя церемония, а анемичная модель плюс валидатор — честное простое решение. Критерий — число инвариантов и переходов состояний. Сигнал, что анемия вредит, — одна и та же проверка состояния в нескольких хендлерах или в контроллере и сервисе одновременно.</p>`
    },
    {
      id: 'arch-033', chapter: 'ddd-strategic', type: 'choice',
      q: `<p>Что такое bounded context?</p>`,
      options: [`Явная граница, внутри которой модель и язык однозначны; обычно ею владеет одна команда`, `Другое название микросервиса`, `Группа агрегатов, сохраняемых в одной транзакции`, `Слой приложения между API и доменом`],
      answer: 0,
      explain: `<p>Bounded context — прежде всего смысловая и организационная граница: внутри неё слово «товар» значит одно. Реализовать его можно модулем монолита, одним или несколькими сервисами, поэтому это не синоним микросервиса. Группа агрегатов в одной транзакции — это вообще не понятие DDD (агрегат сам граница транзакции), а прикладной слой — понятие слоёной архитектуры.</p>`
    },
    {
      id: 'arch-034', chapter: 'ddd-strategic', type: 'choice',
      q: `<p>Новый сервис должен читать данные из legacy-базы с тысячами хранимых процедур, магическими кодами статусов и флагами удаления. Команда legacy не будет ничего менять. Какой паттерн context mapping уместен?</p>`,
      options: [`Shared Kernel`, `Conformist`, `Anticorruption Layer`, `Partnership`],
      answer: 2,
      explain: `<p>Upstream не изменится, а его модель неудобна — нужен слой перевода, который интерпретирует коды и флаги и отдаёт нашей модели чистые понятия. Conformist означал бы принять чужую модель как есть и пустить её понятия по всему новому коду. Shared Kernel и Partnership требуют совместной работы с командой upstream, которой здесь нет.</p>`
    },
    {
      id: 'arch-035', chapter: 'ddd-strategic', type: 'open',
      q: `<p>Что такое core, supporting и generic subdomain и как эта классификация влияет на решения?</p>`,
      answer: `<p>Core domain — то, чем компания отличается от конкурентов и на чём зарабатывает; supporting — специфичное для бизнеса, но не дающее преимущества; generic — типовые задачи, одинаковые у всех (аутентификация, платежи, бухгалтерия, почта).</p>
<p>Классификация отвечает на вопрос, куда вкладывать силы: в core — лучших людей, богатую модель и тщательный дизайн; в supporting — простые решения, CRUD; generic — покупать или брать готовым (Keycloak, платёжный шлюз, 1С). Ошибки — писать свою авторизацию, тратя силы на commodity, или покупать коробку для того, что и есть конкурентное преимущество. Поддомен — пространство проблемы, bounded context — пространство решения; в идеале они совпадают, но не обязаны.</p>`
    },
    {
      id: 'arch-036', chapter: 'ddd-strategic', type: 'choice',
      q: `<p>Почему разбиение на микросервисы «по сущностям» (сервис товаров, сервис клиентов, сервис заказов) обычно плохо?</p>`,
      options: [`Потому что сущностей слишком много и сервисов получится сотни`, `Бизнес-сценарии охватывают несколько сущностей, и каждый превращается в цепочку синхронных вызовов и распределённых транзакций — получается распределённый монолит`, `Потому что у каждого сервиса будет своя база данных`, `Потому что ORM не умеет работать с одной сущностью на сервис`],
      answer: 1,
      explain: `<p>Оформление заказа трогает товары, остатки, клиента и цены; при сервисе на сущность логика сценария не принадлежит никому, задержки и вероятности отказа складываются, а фича требует релиза нескольких сервисов. Граница по bounded context держит язык и правила сценария вместе. Своя база на сервис — как раз желательна, а количество сервисов — не главная проблема.</p>`
    },
    {
      id: 'arch-037', chapter: 'ddd-strategic', type: 'open',
      q: `<p>Как найти границы контекстов в существующей системе? Какие сигналы вы ищете?</p>`,
      answer: `<p>Язык: одно слово с разными значениями у разных людей или одни данные с разными правилами — граница. Изменения: что меняется вместе в одних задачах, а что независимо — история git и тикетов честнее диаграмм. Консистентность: то, что должно быть согласовано в одной транзакции, разрезать дорого. Люди: кто на стороне бизнеса отвечает за какую часть и какие команды разработки.</p>
<p>С экспертами хорошо работает Event Storming (Альберто Брандолини): доменные события по времени на стене, потом команды, акторы, политики; места смены языка и акторов — кандидаты на границы. И я бы проверил границы в модульном монолите, прежде чем резать на сервисы с раздельными базами, — ошибку между модулями исправить в разы дешевле.</p>`
    },
    {
      id: 'arch-038', chapter: 'cqrs', type: 'choice',
      q: `<p>Какое утверждение о CQRS верно?</p>`,
      options: [`CQRS требует отдельной базы для чтения`, `CQRS невозможен без event sourcing`, `Использование MediatR с командами и запросами означает, что в системе есть CQRS`, `CQRS — разделение моделей записи и чтения; простейшая форма — одна база и разный код: агрегаты для команд, прямые проекции для запросов`],
      answer: 3,
      explain: `<p>CQRS — архитектурное развитие CQS Мейера: модели записи и чтения разные. Отдельное хранилище, асинхронные проекции и event sourcing — следующие ступени, каждая со своей ценой. MediatR — диспетчер запросов в процессе; с ним легко сделать «команды и запросы», работающие с одной и той же моделью через одни репозитории, — это не CQRS.</p>`
    },
    {
      id: 'arch-039', chapter: 'cqrs', type: 'open',
      q: `<p>Опишите механику event sourcing: как хранится состояние, как выполняется команда, как обеспечивается конкурентность.</p>`,
      answer: `<p>Вместо текущего состояния хранится упорядоченный append-only поток неизменяемых событий, обычно по потоку на агрегат. Чтобы выполнить команду, события потока загружаются и применяются по порядку (fold), восстанавливая состояние; метод команды проверяет правила и порождает новые события; <code>Apply</code> только меняет поля и никогда не проверяет правила, иначе восстановление сломается при их изменении.</p>
<p>Новые события дописываются с expected version: «добавь в поток X, если его версия N». Уникальный ключ (поток, версия) отклонит запись, если кто-то успел раньше, — это оптимистическая конкурентность. Для длинных потоков — снапшоты как оптимизация. Запросы по текущему состоянию — через проекции, подписанные на поток и строящие read models.</p>`
    },
    {
      id: 'arch-040', chapter: 'cqrs', type: 'choice',
      q: `<p>Как называется техника, при которой старое событие при чтении из event store преобразуется в новую форму до попадания в агрегат?</p>`,
      options: [`Snapshotting`, `Upcasting`, `Copy-transform`, `Projection`],
      answer: 1,
      explain: `<p>Upcaster-ы на границе хранилища превращают <code>PaymentReceived.v1</code> в <code>v2</code>, так что домен знает только последнюю версию, а сами события в хранилище не меняются. Copy-transform переписывает потоки в новом формате — крайняя мера. Снапшот — сохранённое состояние ради скорости загрузки, проекция — построение read model.</p>`
    },
    {
      id: 'arch-041', chapter: 'cqrs', type: 'open',
      q: `<p>Почему нельзя проверять «хватит ли остатка» по асинхронной read model? Как правильно?</p>`,
      answer: `<p>Асинхронная проекция отстаёт от записи. Два конкурентных запроса прочитают одно и то же устаревшее значение «осталось 5», оба решат, что 3 штуки можно взять, и оба запишут — получится минус. Даже без конкуренции проекция может не отражать только что выполненную операцию.</p>
<p>Решения, влияющие на запись, принимаются по write-модели и под защитой от гонок: блокировка (<code>SELECT ... FOR UPDATE</code>, advisory lock по продукту), оптимистическая версия агрегата с повтором при конфликте или констрейнт базы, который физически не допустит нарушения. Read model — для отображения, где задержка в секунды допустима.</p>`
    },
    {
      id: 'arch-042', chapter: 'cqrs', type: 'choice',
      q: `<p>Какой из вариантов — честный компромисс вместо полного event sourcing, когда нужен аудит движений и платежей?</p>`,
      options: [`Хранить текущее состояние как обычно и в той же транзакции дописывать важные факты в append-only лог`, `Писать события в лог-файл приложения через ILogger`, `Использовать триггеры, которые копируют таблицы целиком раз в сутки`, `Хранить только события и восстанавливать состояние на каждый запрос списка`],
      answer: 0,
      explain: `<p>Append-only лог фактов рядом с состоянием даёт историю и аудит там, где они нужны, без восстановления агрегатов из событий, проекций и вечного версионирования. Логи приложения — не надёжный источник: они не транзакционны с данными. Суточные копии не дают «кто и когда», а полный ES без проекций сделает списки невыносимо медленными.</p>`
    },
    {
      id: 'arch-043', chapter: 'cqrs', type: 'open',
      q: `<p>«MediatR — это не CQRS». Объясните и назовите плюсы и минусы MediatR.</p>`,
      answer: `<p>MediatR — внутрипроцессный диспетчер: находит хендлер по типу запроса и прогоняет через pipeline behaviors. CQRS — разделение моделей чтения и записи. Можно сделать CQRS без MediatR и использовать MediatR без CQRS, если команды и запросы идут через одну модель.</p>
<p>Плюсы: хендлер на use case (естественный SRP), тонкие контроллеры, единый вход для HTTP, очередей и тестов, сквозная функциональность в behaviors, которую нельзя забыть. Минусы: косвенность — «Go to Definition» ведёт в библиотеку; соблазн вызывать <code>Send</code> из хендлера; behaviors, выбирающие обработку по типу ответа, хрупки; то же достигается прямым внедрением хендлеров и декораторами. С 2025 года у MediatR коммерческая лицензия для компаний выше порога, поэтому в новых проектах рассматривают source-generated Mediator, Wolverine или ручные хендлеры.</p>`
    },
    {
      id: 'arch-044', chapter: 'sagas', type: 'choice',
      q: `<p>Сага: зарезервировать товар → забронировать слот доставки → списать оплату → подтвердить резерв и слот → отправить письмо клиенту. Какой шаг — pivot transaction?</p>`,
      options: [`Резерв товара`, `Бронь слота доставки`, `Списание оплаты`, `Отправка письма`],
      answer: 2,
      explain: `<p>До списания всё компенсируемо (снять резерв, отменить бронь); после успешного списания сага обязана дойти до конца, и следующие шаги — повторяемые, они могут задержаться, но не отказать по бизнес-причине. Письмо — retriable-шаг после pivot: его не отзовёшь, поэтому оно в конце. Бронь доставки специально поставлена до оплаты, чтобы pivot был как можно позже.</p>`
    },
    {
      id: 'arch-045', chapter: 'sagas', type: 'open',
      q: `<p>Чем компенсирующая транзакция отличается от отката? Что делать, если компенсация не удалась?</p>`,
      answer: `<p>Откат стирает незафиксированные изменения, будто их не было, и их никто не видел. Компенсация — новая бизнес-операция поверх уже зафиксированного и, возможно, увиденного состояния: снять резерв, вернуть деньги, отправить письмо об отмене. Она оставляет след (возврат в выписке), её смысл и правила определяет бизнес — отмена брони может быть платной.</p>
<p>Компенсация может сама не удаться (шлюз недоступен), поэтому её проектируют идемпотентной и повторяемой до успеха: ретраи с backoff, идемпотентный ключ. Если после N попыток не удалось — это инцидент: сага уходит в состояние «требует внимания», сообщение в dead letter, алерт и инструмент ручного разбора. Тихо остановиться сага не имеет права.</p>`
    },
    {
      id: 'arch-046', chapter: 'sagas', type: 'choice',
      q: `<p>Какая контрмера против отсутствия изоляции в саге выражается в состояниях вида <code>ApprovalPending</code> или <code>Reserved (pending)</code>?</p>`,
      options: [`Semantic lock`, `Commutative updates`, `Pessimistic view`, `Version file`],
      answer: 0,
      explain: `<p>Semantic lock — компенсируемый шаг ставит записи флаг «в процессе», и другие операции видят его и ждут, отказывают или учитывают; финальный шаг или компенсация флаг снимают. Commutative updates — операции, порядок которых неважен (инкременты вместо присваиваний). Pessimistic view — порядок шагов, минимизирующий риск грязного чтения. Version file — запоминание операций, пришедших не по порядку.</p>`
    },
    {
      id: 'arch-047', chapter: 'sagas', type: 'open',
      q: `<p>Хореография или оркестрация? Как выбрать и как реализовать оркестратор надёжно?</p>`,
      answer: `<p>Хореография — сервисы реагируют на события друг друга, центра нет: просто для двух-трёх шагов в одной команде, но процесс нигде не описан целиком, состояние экземпляра трудно увидеть, а изменение процесса требует правок у нескольких команд. Оркестрация — оркестратор отправляет команды и реагирует на ответы: процесс в одном месте, видимое состояние, централизованные таймауты и компенсации, простые тесты; цена — ещё один компонент и риск утечки логики участников в него. Для четырёх и более шагов, нескольких команд и сложных компенсаций — оркестрация.</p>
<p>Оркестратор — персистентная state machine: состояние экземпляра в базе с оптимистической блокировкой, каждый переход — «получить сообщение → загрузить → решить → сохранить состояние и исходящие команды через outbox» в одной транзакции, таймауты через отложенные сообщения, идемпотентная обработка повторов. Инструменты — MassTransit state machine с EF Core-репозиторием и outbox, NServiceBus sagas или ручная таблица.</p>`
    },
    {
      id: 'arch-048', chapter: 'sagas', type: 'choice',
      q: `<p>Почему 2PC (XA) избегают между микросервисами?</p>`,
      options: [`Потому что 2PC не гарантирует атомарность`, `Потому что 2PC работает только внутри одной таблицы`, `Потому что 2PC медленнее саги ровно в два раза`, `Протокол блокирующий (участники держат блокировки и ждут координатора), доступность перемножается, а брокеры и внешние API в XA не участвуют`],
      answer: 3,
      explain: `<p>2PC как раз даёт атомарность — ценой блокировок: участник после prepare не может сам решить исход, и падение координатора оставляет его в подвешенном состоянии. Операция доступна, только когда доступны все участники. Kafka, многие NoSQL и HTTP-API в XA не участвуют. Внутри одной распределённой СУБД атомарный коммит по шардам поверх консенсуса — нормальная практика; избегают именно 2PC между независимыми сервисами.</p>`
    },
    {
      id: 'arch-049', chapter: 'sagas', type: 'open',
      q: `<p>Расставьте шаги саги заказа (склад, доставка, оплата, уведомление) с типами и компенсациями и объясните порядок.</p>`,
      answer: `<p>1) Заказ создан в <code>Pending</code> (semantic lock) — компенсация: <code>Rejected</code>. 2) Склад резервирует товар — компенсируемый, компенсация «снять резерв». 3) Доставка бронирует слот — компенсируемый, компенсация «отменить бронь». 4) Списание оплаты — pivot. 5) Подтверждение резерва (задание на сборку) и 6) подтверждение слота — повторяемые. 7) Заказ <code>Confirmed</code> и письмо клиенту — повторяемые.</p>
<p>Логика порядка: всё, что может отказать по бизнес-причине («нет товара», «нет слотов»), идёт до pivot, чтобы большинство отказов ловилось на компенсируемой стадии; некомпенсируемое (письмо) — после. При отказе оплаты компенсации идут в обратном порядке: отмена слота, снятие резерва, отклонение заказа. Вариант усиления — разделить оплату на авторизацию в начале (компенсируемо: снять холд) и capture позже. Каждый шаг — с outbox, идемпотентными обработчиками, таймаутом и correlation id.</p>`
    },
    {
      id: 'arch-050', chapter: 'distributed-patterns', type: 'choice',
      q: `<p>Relay outbox читает строки запросом <code>WHERE id &gt; :lastProcessedId ORDER BY id</code>, где <code>id</code> — <code>bigserial</code>. Какая проблема возможна?</p>`,
      options: [`Никакой: последовательность гарантирует порядок коммитов`, `Транзакция с меньшим id может закоммититься позже той, что с большим, и курсор её проскочит — событие потеряется`, `События будут опубликованы дважды`, `PostgreSQL не позволит читать таблицу, в которую идёт запись`],
      answer: 1,
      explain: `<p>Значение последовательности присваивается при вставке, а видимым оно становится при коммите, и порядок коммитов может отличаться. Курсор «больше последнего обработанного» пропустит строку, ставшую видимой позже. Флаг <code>processed_at</code> с выборкой необработанных (с <code>FOR UPDATE SKIP LOCKED</code>) или CDC по журналу, который идёт в порядке коммитов, такой проблемы не имеют. Дубли возможны в outbox всегда (at-least-once), но не из-за этого.</p>`
    },
    {
      id: 'arch-051', chapter: 'distributed-patterns', type: 'open',
      q: `<p>Расскажите про Transactional Outbox полностью: проблема, решение, relay, гарантии, порядок, очистка.</p>`,
      answer: `<p>Проблема — dual write: изменить базу и опубликовать в брокер атомарно нельзя, и любой порядок при сбое либо теряет событие, либо публикует событие о несостоявшемся изменении; транзакции Kafka не охватывают внешнюю базу. Решение — писать событие в таблицу outbox той же базы в той же транзакции, что и бизнес-изменение (удобно — в <code>SaveChangesInterceptor</code>), а отдельный relay публикует.</p>
<p>Relay: polling — выборка необработанных строк <code>FOR UPDATE SKIP LOCKED</code>, публикация, пометка; просто, но задержка и нагрузка на базу. Или CDC через Debezium с Outbox Event Router — миллисекунды и порядок коммитов, но Kafka Connect и слот репликации, который надо мониторить. Гарантия — at-least-once, поэтому id сообщения стабилен, а потребители идемпотентны. Порядок — ключ партиции по агрегату, осторожно с параллельными relay-ями и курсором по id. Очистка — периодическое удаление обработанных; при CDC можно удалять сразу. Готовое — MassTransit EF outbox, NServiceBus, Wolverine.</p>`
    },
    {
      id: 'arch-052', chapter: 'distributed-patterns', type: 'choice',
      q: `<p>Какое состояние Circuit Breaker пропускает один пробный вызов, чтобы решить, восстановилась ли зависимость?</p>`,
      options: [`Closed`, `Open`, `Isolated`, `Half-Open`],
      answer: 3,
      explain: `<p>В Closed вызовы идут и ошибки считаются; при превышении порога автомат переходит в Open и сразу отклоняет вызовы, давая зависимости восстановиться; через паузу — Half-Open, где пробный вызов решает: успех замыкает автомат, неудача снова размыкает. Isolated — ручное принудительное размыкание в Polly, не стандартное состояние автомата.</p>`
    },
    {
      id: 'arch-053', chapter: 'distributed-patterns', type: 'open',
      q: `<p>Как сделать потребителя Kafka идемпотентным? Где коммитить оффсет?</p>`,
      answer: `<p>Первый выбор — естественная идемпотентность по бизнес-ключу: резерв для заказа X создаётся один раз, повтор возвращает существующий; upsert вместо insert; установка значения вместо инкремента; клиентские id записей. Иначе — inbox: в той же транзакции, что и эффект, вставить id сообщения в таблицу обработанных с уникальным ключом (<code>ON CONFLICT DO NOTHING</code>), и если ничего не вставилось — выйти.</p>
<p>Оффсет коммитится после коммита транзакции: падение между ними приведёт к повторной доставке, которую поймает идемпотентность, а обратный порядок потеряет сообщение. Если обработчик вызывает внешний API, нужен idempotency key и там. Inbox надо чистить, держа id дольше окна возможных повторов.</p>`
    },
    {
      id: 'arch-054', chapter: 'distributed-patterns', type: 'choice',
      q: `<p>Сервис публикует в Kafka PDF счёта размером 8 МБ внутри сообщения, и брокер его отклоняет. Какой паттерн решает задачу?</p>`,
      options: [`Claim Check: сохранить файл в объектное хранилище и отправить в сообщении ссылку`, `Competing Consumers: добавить консьюмеров`, `Dead Letter Channel: отправить сообщение в DLT`, `Увеличить message.max.bytes до 16 МБ на всех брокерах и клиентах`],
      answer: 0,
      explain: `<p>Claim Check: большой payload кладётся в S3/MinIO, а в сообщение идёт «квитанция» со ссылкой. Брокеры плохо работают с большими сообщениями (в Kafka лимит по умолчанию около 1 МБ), и увеличение лимитов бьёт по памяти и репликации. Competing Consumers масштабирует обработку, DLT — для необрабатываемых сообщений; ни то, ни другое не про размер.</p>`
    },
    {
      id: 'arch-055', chapter: 'distributed-patterns', type: 'open',
      q: `<p>Чем Event Notification отличается от Event-Carried State Transfer? Как выбираете?</p>`,
      answer: `<p>Event Notification несёт факт и идентификатор (<code>OrderConfirmed { orderId }</code>); потребитель за деталями ходит в источник. Контракт маленький и стабильный, данные свежие, но потребитель зависит от доступности источника и нагружает его. Event-Carried State Transfer несёт нужные данные (строки, адрес, сумму), и потребитель хранит локальную копию: автономность и отсутствие синхронных вызовов в обмен на больший контракт, дублирование, eventual consistency и риск утечки лишних данных. Различие описано у Фаулера в «What do you mean by Event-Driven?».</p>
<p>Выбираю по потребителю: складу, который собирает заказ, нужны строки — ECST; аудиту и уведомлениям — notification. В обоих случаях наружу идёт интеграционное событие с явной схемой и правилами совместимости, а не внутреннее доменное.</p>`
    },
    {
      id: 'arch-056', chapter: 'distributed-patterns', type: 'choice',
      q: `<p>Три уровня сервисов, каждый делает до 3 попыток вызова нижнего. Нижний сервис перегружен и отвечает 503. Что происходит и что делать?</p>`,
      options: [`Нижний сервис получит 3 запроса — это безопасно`, `Нижний получит 6 запросов; надо добавить jitter`, `Нижний получит до 27 запросов на один пользовательский (retry storm); ретраить на одном уровне, с бюджетом, backoff с jitter и circuit breaker`, `Ретраи не влияют на нагрузку, потому что 503 возвращается мгновенно`],
      answer: 2,
      explain: `<p>Попытки перемножаются по уровням: 3 × 3 × 3 = 27, и перегруженный сервис добивают именно ретраи. Лечение — ретраить на одном уровне (обычно ближе к краю), ограничить общий бюджет попыток и времени, использовать экспоненциальный backoff с jitter и circuit breaker, который быстро отказывает, пока зависимость не восстановится; уважать <code>Retry-After</code>.</p>`
    },
    {
      id: 'arch-057', chapter: 'errors', type: 'choice',
      q: `<p>Какое разделение ошибок по способу сообщения — наиболее распространённый и защищаемый подход?</p>`,
      options: [`Всё — исключениями, глобальный обработчик превращает их в ответы`, `Ожидаемые бизнес-отказы — Result с кодом и аргументами; баги, нарушения контракта и инфраструктурные сбои — исключения`, `Всё — Result, включая таймауты базы и NullReferenceException`, `Бизнес-отказы — исключениями, баги — через Result`],
      answer: 1,
      explain: `<p>Бизнес-отказ — нормальный исход, его стоит видеть в сигнатуре, он не должен стоить раскрутки стека и шуметь в мониторинге. Баги и сбои среды обработать в домене нечем, нужен стектрейс, поэтому — исключения до глобального обработчика. Заворачивать всё в Result значит прятать баги, а всё в исключения — управлять потоком через <code>catch</code>.</p>`
    },
    {
      id: 'arch-058', chapter: 'errors', type: 'open',
      q: `<p>Где должна быть валидация — в FluentValidation или в домене? Опишите слои.</p>`,
      answer: `<p>Слоёв несколько. Структурная валидация на границе (FluentValidation): обязательность, форматы, длины, диапазоны — быстро, без базы, все ошибки полей сразу, это вопрос UX. Инварианты в домене (value objects, методы агрегатов) — должны соблюдаться независимо от источника команды: HTTP, Kafka, фоновая задача, тест. Правила, зависящие от данных (уникальность, существование, права), — в хендлере или домене с данными. Последний рубеж против гонок — констрейнты базы.</p>
<p>Валидация на границе не заменяет инварианты: правило «количество положительное» только в валидаторе контроллера обойдёт консьюмер очереди. Дублирование правила в валидаторе ради UX допустимо — у них разные задачи. Асинхронные валидаторы с запросами к базе нежелательны: дублируют хендлер и не защищают от конкурентности.</p>`
    },
    {
      id: 'arch-059', chapter: 'errors', type: 'choice',
      q: `<p>При регистрации единицы оборудования две параллельные транзакции прошли проверку «асет-тег свободен», и вторая упала с <code>23505 unique_violation</code>. Как это правильно обработать?</p>`,
      options: [`Ничего не делать: 500 — честный ответ на гонку`, `Убрать уникальный индекс, раз проверка в коде уже есть`, `Оставить предварительную проверку ради понятной ошибки, а нарушение индекса перехватить в одном месте и перевести в ту же доменную ошибку с 409`, `Обернуть регистрацию в <code>lock</code> в C#`],
      answer: 2,
      explain: `<p>Индекс — единственная гарантия против гонки, его нельзя убирать; проверка в коде нужна, чтобы в обычном случае вернуть понятный код. Исключение драйвера по смыслу — тот же бизнес-отказ «тег занят», поэтому его переводят в ту же ошибку, а не отдают 500. <code>lock</code> в процессе не работает при нескольких экземплярах сервиса.</p>`
    },
    {
      id: 'arch-060', chapter: 'errors', type: 'open',
      q: `<p>Как вы возвращаете ошибки клиенту API, чтобы клиент мог на них программно реагировать и показывать текст на нужном языке?</p>`,
      answer: `<p>В формате Problem Details (RFC 9457, заменивший 7807) с расширениями: стабильный код ошибки — строковый и числовой, — аргументы для построения своего текста, переведённый <code>detail</code> по <code>Accept-Language</code> из resx-ресурсов и <code>traceId</code> для поддержки. Код — контракт: не меняет смысл и не переиспользуется, текст может меняться, поэтому клиент реагирует на код.</p>
<p>Статусы: 400 — валидация и нарушение правил, 404 — несуществующее (включая чужой тенант), 409 — конфликты и гонки, 500 — неожиданное. Внутренние детали не раскрываются. Тест проверяет, что у каждого кода есть сообщения на всех языках с одинаковыми плейсхолдерами; для плюралов — ICU MessageFormat. Неожиданные исключения — через <code>IExceptionHandler</code> и <code>AddProblemDetails()</code> в том же формате.</p>`
    },
    {
      id: 'arch-061', chapter: 'errors', type: 'choice',
      q: `<p>Что правильно бросить или вернуть в этом guard-е?</p>
<pre><code>public Result Move(Unit unit, Location target)
{
    // (1) unit == null
    // (2) target.IsDeleted
}</code></pre>`,
      options: [`(1) — исключение (<code>ArgumentNullException.ThrowIfNull</code>), (2) — Result с доменной ошибкой`, `Оба — исключения`, `Оба — Result`, `(1) — Result, (2) — исключение`],
      answer: 0,
      explain: `<p>Null вместо обязательного аргумента — нарушение контракта вызывающим кодом, то есть баг: исключение со стектрейсом, а <code>ThrowIfNull</code> сам подставит имя параметра. Закрытое место — ожидаемый бизнес-отказ, о котором надо сказать пользователю, — Result с кодом. Смешение этих двух видов — главный источник путаницы в обработке ошибок.</p>`
    },
    {
      id: 'arch-062', chapter: 'errors', type: 'open',
      q: `<p>Почему не стоит управлять потоком выполнения через исключения?</p>`,
      answer: `<p>Исключения невидимы в сигнатуре — в C# нет checked exceptions, и вызывающий не знает, что метод может отказать. <code>try/catch</code> вместо <code>if</code> плохо читается и легко ловит лишнее: <code>catch (Exception)</code>, написанный ради бизнес-отказа, проглотит и баг. Выброс исключения намного дороже возврата значения (сбор стектрейса, раскрутка стека) — даже после ускорения в .NET 9 при массовых отказах это заметно. И мониторинг: тысячи ожидаемых исключений топят настоящие баги.</p>
<p>Microsoft в Framework Design Guidelines рекомендует для ожидаемых отказов паттерн Try (<code>TryParse</code>, <code>TryGetValue</code>) или возврат результата, оставляя исключения для нарушений контракта и сбоев.</p>`
    },
    {
      id: 'arch-063', chapter: 'monolith', type: 'choice',
      q: `<p>Какой признак наиболее характерен для распределённого монолита?</p>`,
      options: [`В системе больше десяти сервисов`, `Сервисы общаются через Kafka`, `У каждого сервиса своя база данных`, `Фичу нельзя выпустить, не релизя синхронно несколько сервисов, а они читают общие таблицы и вызывают друг друга длинными синхронными цепочками`],
      answer: 3,
      explain: `<p>Распределённый монолит — связанность монолита при сложности распределённой системы: общие данные, синхронные цепочки, совместные релизы. Количество сервисов, брокер и раздельные базы сами по себе — не признаки, а раздельные базы — как раз противоядие.</p>`
    },
    {
      id: 'arch-064', chapter: 'monolith', type: 'open',
      q: `<p>Что такое модульный монолит и какие правила делают его хорошим?</p>`,
      answer: `<p>Один деплой, но внутри модули с жёсткими границами, обычно по bounded contexts. Правила: модуль владеет своими данными — своя схема, никто другой не читает и не пишет его таблицы; узкий публичный API модуля в отдельном проекте контрактов, реализация — <code>internal</code>; взаимодействие через публичный API или события (in-process шина или outbox); границы проверяются ссылками проектов и архитектурными тестами.</p>
<p>Это даёт большую часть пользы микросервисов — независимость моделей, ясное владение, локальность изменений — без сети, саг и eventual consistency, а ошибочную границу можно исправить за дни. Модуль, который владеет данными и общается событиями, позже выносится в сервис почти механически. Цена — дисциплина держится на тестах, модули делят процесс и темп релизов.</p>`
    },
    {
      id: 'arch-065', chapter: 'monolith', type: 'choice',
      q: `<p>Как называется паттерн миграции, при котором новая система постепенно забирает функциональность у старой через перехватывающий фасад, пока старую нельзя будет выключить?</p>`,
      options: [`Branch by Abstraction`, `Strangler Fig`, `Big Bang Rewrite`, `Blue-Green Deployment`],
      answer: 1,
      explain: `<p>Strangler Fig Application (Фаулер): фасад перед старой системой, выделение кусочка, постепенное переключение трафика, синхронизация данных на переходный период и удаление старого кода. Branch by Abstraction — родственный приём внутри кодовой базы (абстракция над старой реализацией, затем новая за ней). Blue-Green — способ деплоя, а «большой взрыв» — как раз то, чего стратегия избегает.</p>`
    },
    {
      id: 'arch-066', chapter: 'monolith', type: 'open',
      q: `<p>Почему у каждого сервиса должна быть своя база, и как тогда отвечать на запросы, которым нужны данные нескольких сервисов?</p>`,
      answer: `<p>Общая база — самая сильная связь: схема становится контрактом для всех читателей, её нельзя менять без согласования, тяжёлые запросы и блокировки одного сервиса бьют по другим. Поэтому сервис владеет данными и отдаёт их только через API или события; физически это может быть один кластер с разными схемами и правами.</p>
<p>Запросы через несколько сервисов — API composition (агрегатор собирает ответ; просто, но синхронно и медленнее) или read model, построенная из событий нескольких сервисов (быстро, но eventual consistency). Согласованность изменений — саги и outbox. Отчётность — отдельное аналитическое хранилище через CDC, а не прямые запросы в базы сервисов.</p>`
    },
    {
      id: 'arch-067', chapter: 'monolith', type: 'choice',
      q: `<p>Какое изменение HTTP API обратно совместимо?</p>`,
      options: [`Добавить необязательное поле в ответ`, `Переименовать поле <code>customer</code> в <code>counterparty</code>`, `Сделать необязательное поле запроса обязательным`, `Изменить тип поля <code>amount</code> со строки на число`],
      answer: 0,
      explain: `<p>Новое необязательное поле в ответе не ломает клиентов, следующих принципу tolerant reader (игнорировать незнакомое). Переименование, смена типа и ужесточение обязательности ломают существующих клиентов и требуют новой версии или expand-and-contract: добавить новое рядом, перевести потребителей, удалить старое.</p>`
    },
    {
      id: 'arch-068', chapter: 'monolith', type: 'open',
      q: `<p>Как закон Конвея влияет на нарезку сервисов? Что такое inverse Conway maneuver?</p>`,
      answer: `<p>Закон Конвея (1968): системы повторяют структуру коммуникаций организаций, которые их создают. Если границы сервисов проходят поперёк команд, каждая фича требует межкомандной координации, и система будет тянуться к форме организации. Одна команда на пятнадцать сервисов получает распределённую систему без выгоды независимости.</p>
<p>Inverse Conway maneuver — сознательно выстроить команды под желаемую архитектуру: независимые контексты — независимые команды, владеющие ими целиком. В терминах Team Topologies (Скелтон и Паис) — stream-aligned команды по потоку ценности, платформенная команда с инфраструктурой как сервисом, enabling и complicated-subsystem; ограничение — когнитивная нагрузка команды.</p>`
    },
    {
      id: 'arch-069', chapter: 'decisions', type: 'choice',
      q: `<p>Какие разделы входят в формат ADR, предложенный Майклом Найгардом?</p>`,
      options: [`Problem, Solution, Code, Tests`, `Situation, Task, Action, Result`, `Title, Status, Context, Decision, Consequences`, `Goals, Non-goals, Timeline, Owners`],
      answer: 2,
      explain: `<p>ADR по Найгарду: название, статус (proposed, accepted, deprecated, superseded), контекст — действующие силы без решения, решение в активном залоге и последствия, включая негативные. STAR — структура рассказа на поведенческом интервью, а «Goals/Non-goals» — раздел design doc, а не ADR.</p>`
    },
    {
      id: 'arch-070', chapter: 'decisions', type: 'open',
      q: `<p>Расскажите о сложном архитектурном решении (структура ответа). Что отличает ответ senior-уровня?</p>`,
      answer: `<p>Структура: контекст в цифрах (система, масштаб, команда) → проблема и почему трудная, с симптомами → рассмотренные альтернативы и почему отвергнуты → решение и <em>ваша</em> роль, как убеждали и согласовывали → результат в метриках → цена, которую заплатили, и что сделали бы иначе.</p>
<p>Senior отличают альтернативы и цена: «выбрали outbox с polling, а не CDC, потому что не было Kafka Connect, и задержка в секунду допустима; заплатили нагрузкой на базу и мониторингом отставания, потребители стали идемпотентными». Ошибки: рассказывать о технологиях вместо проблем, не называть цифр, говорить только «мы», не признавать недостатков решения.</p>`
    },
    {
      id: 'arch-071', chapter: 'decisions', type: 'choice',
      q: `<p>По квадранту технического долга Фаулера, как классифицировать «теперь мы знаем, как надо было сделать»?</p>`,
      options: [`Намеренный и безрассудный`, `Ненамеренный и благоразумный`, `Намеренный и благоразумный`, `Ненамеренный и безрассудный`],
      answer: 1,
      explain: `<p>Команда не планировала долг (ненамеренный) и при этом работала добросовестно — понимание пришло вместе с опытом (благоразумный). «Выпускаем сейчас и разберёмся с последствиями» — намеренный благоразумный, «нет времени на дизайн» — намеренный безрассудный, «что такое слои?» — ненамеренный безрассудный.</p>`
    },
    {
      id: 'arch-072', chapter: 'decisions', type: 'open',
      q: `<p>Как сделать нефункциональное требование полезным для архитектуры? Приведите пример.</p>`,
      answer: `<p>Его нужно сделать проверяемым — сценарием атрибута качества (по SEI: источник, стимул, артефакт, среда, реакция, мера). Не «система должна быть быстрой», а «при 500 RPS запрос списка заказов отвечает за 300 мс на p95»; не «надёжной», а «при падении одной ноды базы приём заказов продолжается, потеря данных не более 1 секунды» (RPO) и SLO доступности 99.9%.</p>
<p>Дальше — приоритеты, потому что атрибуты конфликтуют (согласованность против доступности, производительность против простоты), и архитектура определяется тем, что важнее. И закрепление: нагрузочные тесты с порогом в CI, алерты по SLO, архитектурные тесты — fitness functions, чтобы требование не деградировало молча.</p>`
    },
    {
      id: 'arch-073', chapter: 'decisions', type: 'choice',
      q: `<p>Что такое fitness function в смысле «Building Evolutionary Architectures»?</p>`,
      options: [`Метрика удовлетворённости пользователей`, `Функция в коде, вычисляющая стоимость инфраструктуры`, `Оценка кандидата на собеседовании по архитектуре`, `Автоматическая проверка архитектурной характеристики — например, архитектурный тест на запрещённые зависимости или нагрузочный тест с порогом в CI`],
      answer: 3,
      explain: `<p>Fitness functions превращают архитектурное решение из документа в инвариант, проверяемый автоматически: NetArchTest/ArchUnitNET на направление зависимостей, проверка числа SQL-запросов на endpoint против N+1, diff OpenAPI на ломающие изменения, нагрузочный тест с порогом задержки. Без автоматической проверки решения деградируют за месяцы.</p>`
    }
  ]
});
