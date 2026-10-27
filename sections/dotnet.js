window.PREP = window.PREP || [];
window.PREP.push({
  id: 'dotnet',
  title: 'C# и .NET изнутри',
  chapters: [
    { id: `types`, title: `Типы и память`, html: `<h3>Две семьи типов</h3>
<p>Любой тип в .NET — либо <strong>value type</strong>, либо <strong>reference type</strong>. К value types относятся <code>struct</code>, <code>enum</code>, все примитивы (<code>int</code>, <code>double</code>, <code>bool</code>, <code>char</code>, <code>decimal</code>), <code>DateTime</code>, <code>Guid</code>, <code>Nullable&lt;T&gt;</code>, кортежи <code>ValueTuple</code> и <code>record struct</code>. К reference types — <code>class</code>, <code>interface</code>, <code>delegate</code>, массивы, <code>string</code> и <code>record</code> (он же <code>record class</code>).</p>
<p>Главная разница не в том, «где лежит», а в <strong>семантике копирования и идентичности</strong>:</p>
<ul><li>переменная value type <strong>содержит само значение</strong>; присваивание, передача в метод и возврат из метода копируют все поля целиком;</li><li>переменная reference type содержит <strong>ссылку</strong> на объект в managed heap; присваивание копирует ссылку, и две переменные начинают указывать на один и тот же объект;</li><li>у объекта есть <strong>identity</strong>: два разных объекта с одинаковыми полями — всё равно два объекта, и <code>ReferenceEquals</code> это различает; у значения identity нет;</li><li>у каждого объекта в куче есть заголовок: <strong>object header</strong> (там живёт, например, информация для <code>lock</code> и хэш-код по умолчанию) и указатель на <strong>MethodTable</strong> (описание типа, таблица виртуальных методов). На x64 это 16 байт накладных расходов, и минимальный объект занимает 24 байта. У значения value type заголовка нет — только поля;</li><li>value type не может быть <code>null</code> (кроме <code>Nullable&lt;T&gt;</code>), неявно <code>sealed</code>, наследуется от <code>System.ValueType</code>, но может реализовывать интерфейсы.</li></ul>
<pre><code>struct PointS { public int X; }
class PointC { public int X; }

var s1 = new PointS { X = 1 };
var s2 = s1;      // копия всех полей
s2.X = 2;
Console.WriteLine(s1.X); // 1

var c1 = new PointC { X = 1 };
var c2 = c1;      // копия ссылки
c2.X = 2;
Console.WriteLine(c1.X); // 2</code></pre>
<h3>Миф «value types живут на стеке, reference types — в куче»</h3>
<p>Это самая частая неточность на собеседованиях, и senior-ответ начинается с того, что <strong>спецификация C# говорит о семантике, а не о месте хранения</strong>; место — деталь реализации рантайма. Точная формулировка: <strong>значение value type хранится там же, где его контейнер</strong>.</p>
<ul><li>Локальная переменная типа <code>struct</code> — в кадре стека или вообще в регистре процессора (JIT может разложить небольшую структуру по регистрам).</li><li>Поле типа <code>int</code> внутри класса — внутри объекта, то есть в куче.</li><li>Элементы <code>int[]</code> — внутри массива, то есть в куче, подряд и без заголовков на каждый элемент. Именно поэтому <code>int[]</code> из миллиона элементов — это один объект, а <code>object[]</code> с миллионом упакованных <code>int</code> — миллион и один.</li><li>Локальная переменная, <strong>захваченная лямбдой</strong>, становится полем класса-замыкания и уезжает в кучу.</li><li>Локальная переменная <code>async</code>-метода, живущая через <code>await</code>, становится полем state machine, которая при первой реальной приостановке тоже оказывается в куче. То же касается iterator-методов с <code>yield</code>.</li><li>Упакованное (boxed) значение — в куче.</li></ul>
<p>И обратное тоже не абсолютно: начиная с .NET 9–10 JIT в ограниченных случаях выполняет <strong>escape analysis</strong> и размещает на стеке небольшие объекты, которые гарантированно не покидают метод. Поэтому «класс всегда в куче» — тоже упрощение, хотя для практических рассуждений о нагрузке на GC его обычно достаточно.</p>
<p>Стек — это память конкретного потока, фиксированного размера (на Windows по умолчанию порядка мегабайта). Освобождается он «бесплатно» при выходе из метода, а GC занимается только кучей. Отсюда реальная причина, по которой value types бывают быстрее: <strong>не выделяется объект, нет работы для GC и нет косвенного обращения по ссылке</strong> — а вовсе не магическая скорость стека.</p>
<h3>Boxing и unboxing</h3>
<p><strong>Boxing</strong> — превращение значения в объект: в куче выделяется объект с заголовком, значение копируется внутрь, возвращается ссылка. <strong>Unboxing</strong> — обратная операция: проверка, что объект является упакованным значением именно этого типа, и копирование значения наружу.</p>
<pre><code>int i = 42;
object o = i;          // boxing: аллокация 24 байт и копирование
i = 43;
Console.WriteLine(o);  // 42 — у «коробки» своя копия
int j = (int)o;        // unboxing: проверка типа + копирование
long l = (long)o;      // InvalidCastException: распаковывать можно только в точный тип
long l2 = (int)o;      // так можно: распаковали в int, затем расширили до long</code></pre>
<p>Явный boxing заметить легко. Опасен скрытый:</p>
<ul><li><strong>приведение struct к интерфейсу</strong> или к <code>object</code>: <code>IComparable c = 5;</code>, передача struct в метод, принимающий интерфейс (не generic-параметр, а именно интерфейс);</li><li><strong>старые non-generic API</strong>: <code>ArrayList</code>, <code>Hashtable</code>, <code>params object[]</code>, <code>string.Format("{0}", x)</code>, перегрузки <code>Console.WriteLine(string, object)</code>;</li><li>вызов <code>ToString()</code>, <code>GetHashCode()</code> или <code>Equals(object)</code> у struct, где они <strong>не переопределены</strong>: вызывается реализация из <code>ValueType</code>, работающая с упакованным значением; если метод переопределён, JIT вызывает его через <code>constrained.</code>-префикс без упаковки;</li><li><code>Equals(object)</code> с аргументом-struct — аргумент упаковывается;</li><li><strong><code>Dictionary</code> или <code>HashSet</code> со struct-ключом без <code>IEquatable&lt;T&gt;</code></strong>: <code>EqualityComparer&lt;T&gt;.Default</code> откатывается на <code>Equals(object)</code>, и каждое сравнение ключей упаковывает значение;</li><li><strong><code>foreach</code> через интерфейс</strong>: у <code>List&lt;T&gt;</code> enumerator — struct, и <code>foreach</code> по переменной типа <code>List&lt;T&gt;</code> его не упаковывает, а <code>foreach</code> по <code>IEnumerable&lt;T&gt;</code> — упаковывает (вызов <code>GetEnumerator()</code> через интерфейс возвращает <code>IEnumerator&lt;T&gt;</code>);</li><li>захват в лямбду и <code>async</code> — не boxing в строгом смысле, но тоже перенос значения в кучу.</li></ul>
<p>Что исправили сами компилятор и рантайм: <code>Enum.HasFlag</code> современный JIT больше не упаковывает; интерполяция <code>$"{x}"</code> в C# 10+ при присваивании в <code>string</code> компилируется через <code>DefaultInterpolatedStringHandler</code> с generic-методом <code>AppendFormatted&lt;T&gt;</code>, без упаковки (в отличие от <code>string.Format</code>). Generic-коллекции <code>List&lt;int&gt;</code> хранят значения без упаковки — в этом и был смысл generics.</p>
<p>Найти boxing помогают профилировщик аллокаций (dotMemory, PerfView, <code>dotnet-trace</code> с событиями GC), <code>[MemoryDiagnoser]</code> в BenchmarkDotNet и подсветка аллокаций в IDE (у Rider есть плагин Heap Allocations Viewer).</p>
<h3>Проектирование struct</h3>
<p>Struct подходит, когда тип логически является <strong>одним значением</strong>: деньги, координата, диапазон дат, идентификатор. Классическая рекомендация Framework Design Guidelines: небольшой размер (ориентир — до 16 байт), неизменяемость, редкая упаковка. Большая структура дорога: её копируют при каждом присваивании и передаче.</p>
<p><strong>Мутабельные структуры — источник багов</strong>, потому что легко изменить копию вместо оригинала:</p>
<pre><code>struct Counter
{
    public int Value;
    public void Increment() =&gt; Value++;
}

var list = new List&lt;Counter&gt; { new Counter() };
// list[0].Value = 10;   // CS1612: индексатор вернул копию, менять её бессмысленно
var arr = new[] { new Counter() };
arr[0].Value = 10;       // работает: элемент массива — переменная, а не копия

class Holder
{
    private readonly Counter _c;
    public void Bump()
    {
        _c.Increment();          // компилятор вызывает метод на ЗАЩИТНОЙ КОПИИ
        Console.WriteLine(_c.Value); // 0
    }
}</code></pre>
<p>Последний пример — <strong>defensive copy</strong>. Поле <code>readonly</code>, а метод <code>Increment</code> может изменить структуру; компилятор не знает, изменит ли, и ради гарантии неизменности поля вызывает метод на временной копии. Те же защитные копии появляются у параметров <code>in</code> и у <code>ref readonly</code>-переменных, если структура не помечена как readonly. Решения:</p>
<ul><li><strong><code>readonly struct</code></strong> — компилятор гарантирует, что все поля <code>readonly</code>, и защитные копии не нужны;</li><li><strong><code>readonly</code>-члены</strong> (C# 8): отдельный метод или свойство помечается <code>readonly</code>, если не меняет состояние.</li></ul>
<p>Остальные инструменты:</p>
<ul><li><strong><code>in</code>-параметр</strong> — передача по ссылке только для чтения. Имеет смысл для больших readonly-структур; для маленьких (<code>int</code>, <code>Guid</code>) только мешает, а для не-readonly структур может породить защитные копии.</li><li><strong><code>ref readonly</code></strong> — возврат ссылки только для чтения, а в C# 12 ещё и параметры <code>ref readonly</code> (для API, которому нужна ссылка, но не право записи).</li><li><strong><code>ref struct</code></strong> — структура, которая может жить только на стеке (как <code>Span&lt;T&gt;</code>); подробно — в главе про Span.</li><li><strong><code>record struct</code></strong> (C# 10) генерирует эффективные <code>Equals</code>, <code>GetHashCode</code>, <code>IEquatable&lt;T&gt;</code>, <code>==</code>, <code>ToString</code> и поддержку <code>with</code>. Важная тонкость: у позиционного <code>record struct</code> свойства <strong>изменяемые</strong> (<code>get; set;</code>), а у <code>readonly record struct</code> — <code>init</code>. Для value object почти всегда нужен второй вариант.</li><li>С C# 10 у структур могут быть конструктор без параметров и инициализаторы полей, но <code>default(T)</code>, <code>new T[10]</code> и неинициализированные поля классов их <strong>не вызывают</strong> — там всегда нули. Структура должна осмысленно переживать состояние «все поля по нулям».</li></ul>
<h3>Строки</h3>
<p><code>string</code> — reference type с семантикой значения: оператор <code>==</code> переопределён и сравнивает содержимое. Строки <strong>неизменяемы</strong>: любая «модификация» (<code>Replace</code>, <code>ToUpper</code>, <code>+</code>, <code>Substring</code>) создаёт новую строку. Отсюда плюсы — строки безопасно делить между потоками и использовать как ключи словаря, — и главный минус: конкатенация в цикле квадратична.</p>
<pre><code>string s = "";
foreach (var line in lines)
    s += line;           // на каждой итерации копируется вся накопленная строка: O(n²)

var sb = new StringBuilder();
foreach (var line in lines)
    sb.Append(line);     // амортизированно O(1) на добавление
string result = sb.ToString();</code></pre>
<p><code>StringBuilder</code> внутри — связный список кусков (<code>char[]</code>-чанков): при нехватке места он не копирует всё, а добавляет новый кусок. Для двух-трёх слагаемых <code>+</code> нормален: компилятор превращает <code>a + b + c</code> в один вызов <code>string.Concat</code>. Для склейки коллекции есть <code>string.Join</code>, для строк известной длины без промежуточных буферов — <code>string.Create</code>.</p>
<p><strong>Интернирование.</strong> Строковые литералы из кода помещаются в intern pool: одинаковые литералы — один и тот же объект. Константные выражения складываются компилятором, поэтому <code>"a" + "b"</code> — это литерал <code>"ab"</code>. Строка, построенная в рантайме, — всегда новый объект, даже если содержимое совпадает с литералом. <code>string.Intern(s)</code> возвращает экземпляр из пула, но интернированные строки фактически живут до конца процесса, так что интернировать пользовательские данные — способ устроить утечку.</p>
<p><strong>Сравнение.</strong> Для идентификаторов, ключей и протоколов — <code>StringComparison.Ordinal</code> или <code>OrdinalIgnoreCase</code>. Сравнение через <code>a.ToLower() == b.ToLower()</code> выделяет две новые строки и зависит от культуры (знаменитая турецкая «I»). <code>string.Length</code> — число UTF-16 code units, а не «символов»: эмодзи занимает две единицы.</p>
<h3>Равенство: Equals, GetHashCode и records</h3>
<p>По умолчанию классы сравниваются <strong>по ссылке</strong> (<code>object.Equals</code>). Структуры — по значению, через <code>ValueType.Equals</code>: если в структуре нет ссылочных полей, рантайм может сравнить байты, иначе использует reflection, что медленно. <code>ValueType.GetHashCode</code> по умолчанию даёт слабое распределение. Поэтому структуры, которые сравнивают или кладут в словари, должны переопределять оба метода и реализовывать <code>IEquatable&lt;T&gt;</code> (или быть <code>record struct</code>).</p>
<p>Контракт, который надо уметь произнести:</p>
<ul><li>если <code>a.Equals(b)</code>, то <code>a.GetHashCode() == b.GetHashCode()</code>; обратное не обязано выполняться — совпадение хэшей допустимо (коллизия);</li><li><code>Equals</code> рефлексивен, симметричен, транзитивен, стабилен, и <code>x.Equals(null)</code> — <code>false</code>;</li><li><strong>хэш-код не должен меняться, пока объект лежит в хэш-коллекции</strong> — значит, считать его нужно по неизменяемым полям;</li><li>переопределяя <code>Equals</code>, переопределяют и <code>GetHashCode</code>, а заодно <code>==</code>/<code>!=</code>, чтобы все способы сравнения давали один ответ;</li><li>хэш нескольких полей удобно считать через <code>HashCode.Combine(a, b, c)</code>.</li></ul>
<pre><code>class Sku
{
    public string Code { get; set; } = "";
    public override bool Equals(object? obj) =&gt; obj is Sku other &amp;&amp; other.Code == Code;
    public override int GetHashCode() =&gt; Code.GetHashCode();
}

var set = new HashSet&lt;Sku&gt;();
var sku = new Sku { Code = "A-1" };
set.Add(sku);
sku.Code = "B-2";                    // ключ мутировал внутри коллекции
Console.WriteLine(set.Contains(sku)); // False: ищем в бакете для "B-2", а лежит он в бакете "A-1"</code></pre>
<p><strong>Records.</strong> <code>record</code> (класс) — reference type, для которого компилятор генерирует равенство по значению: сравниваются <code>EqualityContract</code> (фактический тип) и все поля через <code>EqualityComparer&lt;T&gt;.Default</code>. Ещё генерируются <code>==</code>/<code>!=</code>, <code>GetHashCode</code>, <code>ToString</code> с перечислением свойств, <code>Deconstruct</code> для позиционной формы и копирование через <code>with</code>. Тонкости, которые любят спрашивать:</p>
<ul><li><strong>коллекция внутри record сравнивается по ссылке</strong>: два <code>record Order(int Id, List&lt;string&gt; Tags)</code> с одинаковыми списками, но разными объектами списков, не равны;</li><li><code>with</code> делает <strong>поверхностную</strong> копию: новый record ссылается на тот же список;</li><li>из-за <code>EqualityContract</code> экземпляр базового record и экземпляр наследника с теми же значениями не равны;</li><li>позиционные свойства <code>record class</code> — <code>init</code>-only, то есть неизменяемые после создания, но объекты, на которые они ссылаются, могут быть изменяемыми.</li></ul>
<h3>Что спросят на собеседовании</h3>
<details><summary>«Где хранятся value types — на стеке?»</summary>
<p>Начну с того, что «на стеке» — неточная формулировка. Спецификация C# описывает <strong>семантику</strong>, а не место хранения: значение value type хранится <strong>там же, где его контейнер</strong>.</p>
<ul><li>локальная переменная-struct — в кадре стека или вообще в регистре;</li><li>поле <code>int</code> внутри класса и элементы <code>int[]</code> — внутри объекта, то есть в куче;</li><li>локальная переменная, захваченная лямбдой, становится полем display class и уезжает в кучу; то же с переменными async- и iterator-методов, живущими через <code>await</code>/<code>yield</code> — они становятся полями state machine;</li><li>упакованное значение — в куче.</li></ul>
<p>И обратное не абсолютно: начиная с .NET 9–10 JIT с escape analysis может разместить на стеке небольшой объект, который не покидает метод. Настоящая разница типов — в <strong>семантике копирования и identity</strong>: value type копируется целиком и identity не имеет, у reference type копируется ссылка, у объекта есть заголовок (object header + указатель на MethodTable, 16 байт на x64). А value types бывают быстрее не из-за «быстрого стека», а потому что нет аллокации, работы для GC и косвенного обращения.</p>
</details>
<details><summary>«Что такое boxing и где он прячется?»</summary>
<p>Boxing — это аллокация объекта в куче с заголовком и копирование значения внутрь; unboxing — проверка, что объект является упакованным значением <strong>именно этого</strong> типа, и копирование наружу. Поэтому <code>(long)(object)42</code> бросит <code>InvalidCastException</code> — распаковывать можно только в точный тип. У «коробки» своя копия: изменение исходной переменной её не меняет.</p>
<p>Явный boxing виден сразу, опасен скрытый:</p>
<ul><li>приведение struct к интерфейсу или <code>object</code>, передача struct в параметр интерфейсного типа (не generic-параметр, а именно интерфейс);</li><li>non-generic API: <code>ArrayList</code>, <code>Hashtable</code>, <code>params object[]</code>, <code>string.Format</code>;</li><li>вызов непереопределённых <code>ToString</code>/<code>GetHashCode</code>/<code>Equals</code> у struct — работает реализация <code>ValueType</code> над упакованным значением;</li><li>struct-ключ в <code>Dictionary</code>/<code>HashSet</code> без <code>IEquatable&lt;T&gt;</code> — каждое сравнение упаковывает;</li><li><code>foreach</code> по <code>IEnumerable&lt;T&gt;</code> вместо <code>List&lt;T&gt;</code> — struct-enumerator упаковывается.</li></ul>
<p>Многое уже починили: <code>Enum.HasFlag</code> JIT больше не упаковывает, интерполяция строк с C# 10 идёт через <code>DefaultInterpolatedStringHandler</code> без упаковки. Ищу boxing профилировщиком аллокаций (dotMemory, PerfView, <code>dotnet-trace</code>) и <code>[MemoryDiagnoser]</code> в BenchmarkDotNet — и правлю только то, что видно в горячем пути.</p>
</details>
<details><summary>«Когда выбирать struct, а когда class?»</summary>
<p>Struct — когда тип логически является <strong>одним значением</strong>: деньги, координата, диапазон дат, строго типизированный идентификатор. Ориентиры из Framework Design Guidelines: небольшой размер (порядка 16 байт), неизменяемость, редкая упаковка. Большую структуру невыгодно копировать при каждом присваивании и передаче, а частая упаковка съедает весь выигрыш.</p>
<p>На практике я пишу <code>readonly struct</code> или <code>readonly record struct</code>: компилятор гарантирует неизменяемость, не нужны защитные копии, а record даёт эффективное равенство и <code>IEquatable&lt;T&gt;</code>. Важно помнить, что <code>default(T)</code> и <code>new T[10]</code> не вызывают конструктор без параметров — структура обязана осмысленно переживать состояние «все поля нули». Если нужна identity, наследование, разделяемое изменяемое состояние или объект большой — это class.</p>
</details>
<details><summary>«Что такое defensive copy?»</summary>
<p>Это скрытая копия, которую делает компилятор, когда вызывает метод у <strong>не-readonly структуры</strong>, лежащей в readonly-месте: <code>readonly</code>-поле, <code>in</code>-параметр, <code>ref readonly</code>-переменная. Компилятор не знает, изменит ли метод структуру, и ради гарантии неизменности вызывает его на временной копии.</p>
<pre><code>private readonly Counter _c;
_c.Increment();              // вызов на копии
Console.WriteLine(_c.Value); // 0</code></pre>
<p>Последствия два: тихий баг (изменение «пропадает») и лишнее копирование больших структур. Лечится <code>readonly struct</code> или пометкой отдельных методов и свойств как <code>readonly</code> (C# 8) — тогда компилятор знает, что копия не нужна. Отсюда же правило: <code>in</code>-параметр имеет смысл только для больших readonly-структур, для маленьких и мутабельных он скорее вредит.</p>
</details>
<details><summary>«Почему конкатенация строк в цикле плоха и как устроен StringBuilder?»</summary>
<p>Строки неизменяемы: каждое <code>s += line</code> создаёт новую строку и копирует в неё всё накопленное, поэтому цикл получается O(n²) по времени и даёт кучу мусора (большие промежуточные строки ещё и попадают в LOH). Неизменяемость при этом полезна: строки безопасно делить между потоками и использовать как ключи.</p>
<p><code>StringBuilder</code> внутри — связный список <code>char[]</code>-чанков: при нехватке места он не копирует всё, а добавляет новый кусок, поэтому <code>Append</code> амортизированно O(1), а итоговая строка собирается один раз в <code>ToString()</code>. Но для двух-трёх слагаемых <code>+</code> нормален — компилятор превращает <code>a + b + c</code> в один <code>string.Concat</code>. Для склейки коллекции — <code>string.Join</code>, для строки известной длины без промежуточных буферов — <code>string.Create</code>.</p>
</details>
<details><summary>«Расскажите контракт Equals/GetHashCode. Что будет, если мутировать ключ словаря?»</summary>
<p>Контракт:</p>
<ul><li>если <code>a.Equals(b)</code>, то хэш-коды равны; обратное не обязательно — коллизии допустимы;</li><li><code>Equals</code> рефлексивен, симметричен, транзитивен, стабилен, а <code>x.Equals(null)</code> — <code>false</code>;</li><li>хэш не должен меняться, пока объект лежит в хэш-коллекции, поэтому считается по неизменяемым полям;</li><li>переопределил <code>Equals</code> — переопредели <code>GetHashCode</code> и <code>==</code>/<code>!=</code>; хэш нескольких полей — через <code>HashCode.Combine</code>.</li></ul>
<p>Если ключ мутировал после добавления, объект физически остаётся в бакете старого хэша, а поиск идёт в бакет нового — <code>Contains</code> вернёт <code>false</code>, удалить его тоже не получится. Объект «теряется» в коллекции, хотя занимает в ней место. Поэтому ключи должны быть неизменяемыми — идеально подходят строки, <code>Guid</code>, <code>readonly record struct</code>. Для структур, которые кладут в словари, важно реализовать <code>IEquatable&lt;T&gt;</code>: дефолтный <code>ValueType.Equals</code> может использовать reflection, а <code>ValueType.GetHashCode</code> даёт слабое распределение.</p>
</details>
<details><summary>«Чем record отличается от class и от record struct?»</summary>
<p><code>record</code> (он же <code>record class</code>) — это reference type, для которого компилятор генерирует равенство по значению (сравниваются <code>EqualityContract</code> и все поля через <code>EqualityComparer&lt;T&gt;.Default</code>), <code>==</code>/<code>!=</code>, <code>GetHashCode</code>, <code>ToString</code> со свойствами, <code>Deconstruct</code> для позиционной формы и копирование через <code>with</code>. Позиционные свойства — <code>init</code>-only.</p>
<p>Тонкости, о которых стоит сказать:</p>
<ul><li>коллекция внутри record сравнивается по ссылке — два record с «одинаковыми» списками не равны;</li><li><code>with</code> делает поверхностную копию;</li><li>из-за <code>EqualityContract</code> базовый record и наследник с теми же значениями не равны.</li></ul>
<p><code>record struct</code> — value type с теми же генерированными членами, без аллокации. Но у позиционного <code>record struct</code> свойства <strong>изменяемые</strong> (<code>get; set;</code>), а у <code>readonly record struct</code> — <code>init</code>. Для value object почти всегда нужен <code>readonly record struct</code>; для DTO и сообщений — обычный <code>record</code>.</p>
</details>
<details><summary>«Как упаковывается Nullable&lt;T&gt;?»</summary>
<p><code>Nullable&lt;T&gt;</code> — структура из значения и флага <code>HasValue</code>, но рантайм упаковывает её особым образом: упаковка <code>int?</code> без значения даёт обычный <code>null</code>, а со значением — упакованный <code>int</code>, а не «упакованный Nullable». Поэтому <code>object o = (int?)5; o.GetType()</code> вернёт <code>System.Int32</code>, а <code>(int?)null</code>, приведённый к <code>object</code>, равен <code>null</code>. Распаковать упакованный <code>int</code> можно и в <code>int</code>, и в <code>int?</code>.</p>
<p>Практически это значит, что «пустой» nullable никогда не превращается в объект в куче, а проверка <code>o is int</code> работает одинаково для упакованных <code>int</code> и <code>int?</code>.</p>
</details>` },
    { id: `gc`, title: `Сборщик мусора и ресурсы`, html: `<h3>Как выделяется память</h3>
<p>Выделение объекта в .NET очень дешёвое. У каждого потока есть <strong>allocation context</strong> — кусок заранее выделенной памяти в поколении 0, и <code>new</code> в обычном случае просто сдвигает указатель («bump pointer») и обнуляет память. Дорого не выделение, а то, что за ним следует: каждый выделенный байт приближает следующую сборку. Когда <strong>бюджет поколения 0</strong> исчерпан, запускается GC. Другие поводы: явный <code>GC.Collect()</code>, нехватка памяти в системе или контейнере, превышение бюджета LOH.</p>
<h3>Поколения</h3>
<p>GC в .NET — <strong>поколенческий, трассирующий, уплотняющий</strong>. В основе лежит эмпирическая «поколенческая гипотеза»: большинство объектов умирает молодыми (временные строки, DTO запроса, итераторы LINQ), а пережившие несколько сборок живут долго (кеши, синглтоны, пулы).</p>
<ul><li><strong>Gen 0</strong> — новые объекты. Сборка gen0 самая частая и быстрая: проверяются только молодые объекты.</li><li><strong>Gen 1</strong> — буфер между молодыми и старыми: объекты, пережившие одну сборку. Сборка gen1 включает gen0.</li><li><strong>Gen 2</strong> — долгоживущие объекты. Сборка gen2 — это <strong>full GC</strong>: собирается вся куча, включая LOH. Она самая дорогая.</li></ul>
<p>Пережившие сборку объекты <strong>продвигаются</strong> (promote) в следующее поколение. gen0 и gen1 вместе называют эфемерными поколениями.</p>
<p>Отсюда антипаттерн <strong>mid-life crisis</strong>: объекты живут достаточно долго, чтобы доехать до gen2, а потом умирают — например, кеш с TTL в несколько минут или буферы, которые держат между запросами. Они не дают эфемерным сборкам делать свою работу и приводят к частым дорогим full GC. Идеальный профиль приложения: объекты либо умирают в gen0, либо живут вечно.</p>
<h3>Что делает сборка: mark и compact</h3>
<ol><li><strong>Mark.</strong> GC начинает с <strong>корней</strong> (roots) и помечает всё достижимое. Корни — это локальные переменные и аргументы в кадрах стека и регистрах всех потоков (JIT сообщает, какие из них ещё «живы» в данной точке метода), статические поля, GC handles (сильные, pinned) и очередь финализации. Всё, до чего нельзя дойти от корней, — мусор, даже если объекты ссылаются друг на друга по кругу: циклы для трассирующего GC не проблема, в отличие от подсчёта ссылок.</li><li><strong>Plan / Relocate / Compact.</strong> Живые объекты сдвигаются друг к другу, ссылки на них обновляются, свободная память становится непрерывной. Уплотнение устраняет фрагментацию и сохраняет дешёвое bump-pointer-выделение. Иногда GC решает не уплотнять, а <strong>подмести</strong> (sweep) — сложить свободные промежутки в free list; так обычно поступают с gen2 и LOH.</li></ol>
<p>Тонкость про «живость» локальных переменных: в Release-сборке объект может быть собран <strong>до конца метода</strong>, если переменная больше не используется. Это важно для объектов, чей финализатор что-то освобождает, пока нативный код ещё работает; для этого есть <code>GC.KeepAlive(obj)</code>.</p>
<h3>Card table и write barrier</h3>
<p>Если gen0 собирается отдельно, как узнать, что на молодой объект не ссылается какой-нибудь старый объект из gen2? Сканировать весь gen2 на каждой эфемерной сборке — значит потерять весь смысл поколений. Решение — <strong>card table</strong>: куча старших поколений разбита на небольшие участки («карты»), и для каждой есть бит «здесь могла появиться ссылка на молодой объект».</p>
<p>Устанавливает эти биты <strong>write barrier</strong> — маленький фрагмент кода, который JIT вставляет в каждую запись ссылки в поле объекта в куче. При сборке gen0 GC сканирует только «грязные» карты старших поколений и считает найденные там ссылки дополнительными корнями. Практические следствия:</p>
<ul><li>запись ссылки в поле немного дороже записи <code>int</code> — это цена поколений;</li><li>большие долгоживущие структуры, в которые постоянно пишут ссылки на свежие объекты (огромный кеш-словарь, который непрерывно обновляется), делают эфемерные сборки дороже.</li></ul>
<h3>LOH и POH</h3>
<p><strong>Large Object Heap</strong> — отдельная область для объектов размером <strong>от 85 000 байт</strong> (порог настраивается <code>GCLOHThreshold</code>). На практике это большие массивы и строки. Особенности:</p>
<ul><li>LOH логически собирается только вместе с gen2, то есть только при full GC;</li><li>по умолчанию LOH <strong>не уплотняется</strong> (копировать большие объекты дорого), поэтому возможна фрагментация; разово уплотнить можно через <code>GCSettings.LargeObjectHeapCompactionMode = GCLargeObjectHeapCompactionMode.CompactOnce</code>;</li><li>память для большого объекта обнуляется, что само по себе заметно;</li><li>частые временные большие массивы (например, <code>new byte[1_000_000]</code> на каждый запрос) — классическая причина частых full GC; лечится пулами (<code>ArrayPool&lt;T&gt;</code>) и потоковой обработкой.</li></ul>
<p><strong>Pinned Object Heap</strong> (.NET 5) — область для объектов, которые будут закреплены надолго (буферы для нативного I/O). Закреплённый (pinned) объект GC не может двигать; закреплённые объекты посреди эфемерной кучи мешают уплотнению. Закрепить объект можно через <code>fixed</code>, <code>GCHandle.Alloc(obj, GCHandleType.Pinned)</code> или сразу выделить его в POH: <code>GC.AllocateArray&lt;byte&gt;(4096, pinned: true)</code>. Короткий <code>fixed</code> на время вызова — нормально; долгий pin в обычной куче — фрагментация.</p>
<p>С .NET 7 управляемая куча в 64-битных процессах устроена из <strong>regions</strong> вместо больших сегментов: так проще возвращать память ОС и перераспределять её между поколениями. На собеседовании достаточно знать, что такой переход был.</p>
<h3>Workstation и Server GC, фоновая сборка</h3>
<table><thead><tr><th></th><th>Workstation GC</th><th>Server GC</th></tr></thead><tbody><tr><td>Кучи</td><td>одна</td><td>по одной на логическое ядро (с DATAS — меньше, адаптивно)</td></tr><tr><td>Потоки GC</td><td>сборка выполняется на потоке, который её вызвал</td><td>выделенные потоки GC, по одному на кучу, работают параллельно</td></tr><tr><td>Бюджет gen0</td><td>меньше, сборки чаще</td><td>больше, сборки реже, пропускная способность выше</td></tr><tr><td>Память</td><td>экономнее</td><td>заметно больше</td></tr><tr><td>По умолчанию</td><td>десктоп, консольные приложения</td><td>ASP.NET Core</td></tr></tbody></table>
<p><strong>Concurrent / background GC</strong> (включён по умолчанию для обоих режимов) выполняет маркировку <strong>gen2</strong> параллельно с работой приложения на отдельном фоновом потоке; во время фоновой сборки могут проходить обычные эфемерные сборки. Фоновая сборка не уплотняет, а паузы у неё есть только в начале и в конце. Эфемерные сборки всегда блокирующие (stop-the-world), но короткие.</p>
<p><strong>DATAS</strong> (Dynamic Adaptation To Application Sizes) появился в .NET 8 и с .NET 9 включён по умолчанию для Server GC: число куч подстраивается под реальную нагрузку. Это важно для контейнеров: классический Server GC в поде с большим лимитом CPU создавал много куч и «съедал» память даже у сервиса под небольшой нагрузкой. GC учитывает лимиты контейнера (cgroups) по памяти и CPU; жёсткий лимит кучи задаётся <code>GCHeapHardLimit</code> или <code>GCHeapHardLimitPercent</code>.</p>
<p>Режимы переключаются в csproj (<code>&lt;ServerGarbageCollection&gt;</code>, <code>&lt;ConcurrentGarbageCollection&gt;</code>), в <code>runtimeconfig.json</code> (<code>System.GC.Server</code>) или переменными окружения (<code>DOTNET_gcServer=1</code>). Для критичных к задержкам участков есть <code>GCSettings.LatencyMode = GCLatencyMode.SustainedLowLatency</code> (избегать блокирующих full GC) и <code>GC.TryStartNoGCRegion</code> (короткий участок совсем без сборок, если хватит заранее выделенного бюджета).</p>
<h3>Как сократить аллокации и паузы</h3>
<p>Лучший способ уменьшить паузы GC — <strong>меньше выделять</strong>, особенно на горячих путях:</p>
<ul><li>не упаковывать struct (см. главу о типах), не использовать non-generic коллекции;</li><li>не создавать замыкания и делегаты в горячем цикле, кешировать делегаты, использовать <code>static</code>-лямбды;</li><li>заранее задавать ёмкость <code>List&lt;T&gt;</code>, <code>Dictionary</code>, <code>StringBuilder</code>;</li><li>работать со срезами через <code>Span&lt;T&gt;</code>/<code>ReadOnlySpan&lt;char&gt;</code> вместо <code>Substring</code> и <code>Split</code>;</li><li>брать большие буферы из <code>ArrayPool&lt;T&gt;.Shared</code>, а объекты — из <code>ObjectPool&lt;T&gt;</code> (Microsoft.Extensions.ObjectPool);</li><li>использовать <code>ValueTask</code> там, где метод часто завершается синхронно;</li><li>не держать «чуть-чуть долгоживущие» объекты (mid-life crisis);</li><li>для сериализации — source-generated <code>System.Text.Json</code> и потоковое чтение вместо загрузки всего в строку.</li></ul>
<p>Диагностика: <code>dotnet-counters monitor</code> показывает время в GC, скорость выделения, число сборок по поколениям, размеры куч; <code>dotnet-gcdump</code> снимает граф объектов, <code>dotnet-trace</code> и PerfView — события GC и аллокаций; из кода — <code>GC.CollectionCount(gen)</code>, <code>GC.GetTotalAllocatedBytes()</code>, <code>GC.GetGCMemoryInfo()</code>. В бенчмарках — <code>[MemoryDiagnoser]</code>.</p>
<h3>Финализаторы и очередь финализации</h3>
<p>Финализатор (<code>~MyClass()</code>) — метод, который GC вызывает перед освобождением объекта. Механика:</p>
<ol><li>При создании объекта с финализатором ссылка на него регистрируется в <strong>finalization queue</strong> — поэтому выделение такого объекта дороже.</li><li>Когда объект становится недостижимым, GC не освобождает его, а переносит ссылку в очередь <strong>f-reachable</strong>. Эта очередь — корень, так что объект и всё, на что он ссылается, <strong>переживают сборку</strong> и продвигаются в следующее поколение.</li><li>Отдельный <strong>finalizer thread</strong> вызывает финализаторы по очереди.</li><li>Только на следующей сборке соответствующего поколения память реально освобождается.</li></ol>
<p>Следствия: финализатор продлевает жизнь объекта минимум на одну сборку (а часто до gen2); порядок вызова финализаторов не определён; поток финализации один, и медленный или зависший финализатор задерживает все остальные; необработанное исключение в финализаторе завершает процесс; в .NET Core и новее финализаторы <strong>не вызываются при завершении процесса</strong>. Поэтому финализатор — только страховочная сетка для неуправляемых ресурсов, а не способ «закрыть файл».</p>
<h3>IDisposable, IAsyncDisposable и Dispose pattern</h3>
<p><code>IDisposable.Dispose()</code> — детерминированное освобождение ресурсов: соединений, файлов, сокетов, блокировок, подписок. <code>using</code> гарантирует вызов в <code>finally</code>. GC о <code>Dispose</code> ничего не знает — это обычный метод.</p>
<p>Полный <strong>Dispose pattern</strong> нужен только классу, который <strong>напрямую владеет неуправляемым ресурсом</strong> (сырой <code>IntPtr</code>), и при этом может иметь наследников:</p>
<pre><code>public class NativeBuffer : IDisposable
{
    private IntPtr _ptr;
    private bool _disposed;

    public NativeBuffer(int size) =&gt; _ptr = Marshal.AllocHGlobal(size);

    public void Dispose()
    {
        Dispose(disposing: true);
        GC.SuppressFinalize(this);   // финализатор больше не нужен — объект не попадёт в f-reachable
    }

    protected virtual void Dispose(bool disposing)
    {
        if (_disposed) return;          // Dispose должен быть идемпотентным
        if (disposing)
        {
            // освобождаем управляемые IDisposable-поля: вызов из Dispose, они ещё живы
        }
        Marshal.FreeHGlobal(_ptr);      // неуправляемое освобождаем всегда
        _ptr = IntPtr.Zero;
        _disposed = true;
    }

    ~NativeBuffer() =&gt; Dispose(disposing: false); // из финализатора управляемые поля трогать нельзя:
                                                  // они могли быть уже финализированы
}</code></pre>
<p>На практике в современном коде сырые хэндлы оборачивают в <strong>SafeHandle</strong>, и тогда финализатор писать не нужно вовсе. <code>SafeHandle</code> — это готовый объект-владелец хэндла с критическим финализатором и подсчётом ссылок: P/Invoke увеличивает счётчик на время вызова, поэтому хэндл не закроется посреди нативной операции в другом потоке и не будет переиспользован ОС под другой ресурс (handle recycling). Для <code>sealed</code>-класса, который владеет только управляемыми <code>IDisposable</code>-полями, достаточно простого <code>Dispose()</code>, вызывающего их <code>Dispose()</code>. После освобождения методы объекта обычно бросают исключение: <code>ObjectDisposedException.ThrowIf(_disposed, this)</code> (.NET 7+).</p>
<p><strong>IAsyncDisposable</strong> и <code>await using</code> нужны, когда освобождение само требует I/O: сбросить буфер в поток, корректно закрыть сетевое соединение, дождаться отправки. <code>DisposeAsync()</code> возвращает <code>ValueTask</code>. Если класс реализует оба интерфейса, общую логику выносят в <code>protected virtual ValueTask DisposeAsyncCore()</code>.</p>
<p>Ловушка DI: контейнер <code>Microsoft.Extensions.DependencyInjection</code> сам вызывает <code>Dispose</code> у созданных им scoped и transient-объектов при уничтожении scope. Transient <code>IDisposable</code>, полученный из <strong>корневого</strong> провайдера, будет храниться контейнером до конца жизни приложения — это утечка.</p>
<h3>WeakReference и ConditionalWeakTable</h3>
<p><code>WeakReference&lt;T&gt;</code> ссылается на объект, не удерживая его от сборки: <code>TryGetTarget(out var target)</code> вернёт <code>false</code>, если объект уже собран. Для кешей слабые ссылки подходят плохо: GC собирает такие объекты при первой же сборке, не думая о вашей стратегии вытеснения — лучше <code>MemoryCache</code> с лимитом размера. <code>ConditionalWeakTable&lt;TKey, TValue&gt;</code> позволяет «прикрепить» данные к объекту, не продлевая ему жизнь: значение живёт, пока жив ключ.</p>
<h3>Утечки памяти в управляемом коде</h3>
<p>GC собирает только недостижимое. Утечка в .NET — это <strong>объект, который остаётся достижимым, хотя больше не нужен</strong>. Типичные причины:</p>
<ul><li><strong>События.</strong> Издатель держит делегат, делегат держит подписчика (<code>_target</code>). Долгоживущий издатель (синглтон, статическое событие) не даст собрать ни одного подписчика, который не отписался.</li><li><strong>Статические кеши и словари</strong>, которые только растут: «кеш» без вытеснения — это утечка с хорошим названием.</li><li><strong>Замыкания</strong>, сохранённые в долгоживущем месте и захватившие больше, чем нужно (часто — <code>this</code> целиком или большой буфер).</li><li><strong><code>CancellationToken.Register</code></strong> на долгоживущем токене (например, токене остановки приложения) без <code>Dispose</code> возвращённой регистрации: каждый вызов добавляет колбэк, который живёт вместе с токеном. То же с linked token sources, которые не освободили.</li><li><strong>Таймеры.</strong> Активный таймер держит свой колбэк и всё, что тот захватил, пока его не остановят. Обратная ловушка: на <code>System.Threading.Timer</code>, на который никто не ссылается, может сработать сборка — и таймер молча перестанет тикать.</li><li><strong>Captive dependency</strong> в DI: синглтон, захвативший scoped-сервис (например, <code>DbContext</code>), держит его вечно.</li><li>Неограниченные очереди (<code>Channel.CreateUnbounded</code>, <code>ConcurrentQueue</code>), куда пишут быстрее, чем читают.</li></ul>
<p>Искать утечки: снять два дампа кучи с интервалом (<code>dotnet-gcdump collect</code>, dotMemory), сравнить, какие типы растут, и посмотреть <strong>пути удержания до корня</strong> (retention path) — что именно держит объект.</p>
<h3>Что спросят на собеседовании</h3>
<details><summary>«Расскажите, как работает GC в .NET»</summary>
<p>GC в .NET — <strong>поколенческий, трассирующий и уплотняющий</strong>. Выделение дешёвое: у потока есть allocation context в gen0, и <code>new</code> обычно просто сдвигает указатель. Когда исчерпан бюджет gen0, запускается сборка.</p>
<p>Опирается он на поколенческую гипотезу: большинство объектов умирает молодыми. Поэтому куча делится на gen0 (новые объекты, самая частая и дешёвая сборка), gen1 (буфер) и gen2 (долгоживущие; сборка gen2 — это full GC вместе с LOH, самая дорогая). Пережившие сборку объекты продвигаются в следующее поколение.</p>
<p>Сама сборка — это <strong>mark</strong>: от корней (локальные переменные и аргументы в стеках и регистрах, статические поля, GC handles, очередь финализации) помечается всё достижимое; циклические ссылки трассирующему GC не мешают. Затем <strong>compact</strong>: живые объекты сдвигаются, ссылки обновляются, свободная память становится непрерывной — это сохраняет bump-pointer-выделение. Иногда GC вместо уплотнения делает sweep в free list, обычно для gen2 и LOH. Эфемерные сборки дешёвые, потому что смотрят только на молодые объекты — плюс «грязные» карты card table.</p>
</details>
<details><summary>«Зачем нужны card table и write barrier?»</summary>
<p>Чтобы собрать gen0 отдельно, GC должен знать, не ссылается ли на молодой объект кто-то из gen2. Сканировать весь gen2 на каждой эфемерной сборке — значит потерять смысл поколений.</p>
<p>Поэтому старшие поколения разбиты на «карты», и у каждой есть бит «здесь могла появиться ссылка на молодой объект». Бит ставит <strong>write barrier</strong> — небольшой код, который JIT вставляет в каждую запись ссылки в поле объекта в куче. При сборке gen0 GC сканирует только грязные карты и считает найденные ссылки дополнительными корнями.</p>
<p>Следствия: запись ссылки в поле чуть дороже записи <code>int</code>, а огромный долгоживущий кеш, в который постоянно пишут ссылки на свежие объекты, делает эфемерные сборки дороже — много грязных карт.</p>
</details>
<details><summary>«Что такое LOH и чем он опасен?»</summary>
<p>Large Object Heap — область для объектов от <strong>85 000 байт</strong> (порог настраивается <code>GCLOHThreshold</code>), на практике это большие массивы и строки. Он собирается только вместе с gen2, то есть при full GC, и по умолчанию <strong>не уплотняется</strong>, потому что двигать большие объекты дорого — отсюда фрагментация. Ещё память большого объекта обнуляется, что тоже заметно.</p>
<p>Классическая проблема: <code>new byte[1_000_000]</code> на каждый запрос. Каждый такой буфер расходует бюджет LOH и приближает full GC, и сервис начинает часто останавливаться на дорогих сборках. Лечится <code>ArrayPool&lt;T&gt;.Shared</code>, потоковой обработкой вместо загрузки всего в память, заранее заданной ёмкостью коллекций (растущий <code>List</code> тоже оставляет большие промежуточные массивы). Разово уплотнить LOH можно через <code>GCSettings.LargeObjectHeapCompactionMode = CompactOnce</code>, но это лечение симптома.</p>
<p>Рядом стоит упомянуть POH (.NET 5): отдельная куча для долго закреплённых буферов, <code>GC.AllocateArray&lt;byte&gt;(n, pinned: true)</code>, чтобы pinned-объекты не мешали уплотнению обычной кучи.</p>
</details>
<details><summary>«Workstation или Server GC? Что по умолчанию в ASP.NET Core и что такое DATAS?»</summary>
<p><strong>Workstation GC</strong> — одна куча, сборка на потоке, который её вызвал, маленький бюджет gen0, экономнее по памяти; по умолчанию для десктопа и консоли. <strong>Server GC</strong> — по куче и выделенному потоку GC на логическое ядро, сборки параллельные и реже, выше пропускная способность, но памяти уходит заметно больше; по умолчанию в ASP.NET Core. В обоих режимах по умолчанию включён background GC: маркировка gen2 идёт параллельно с приложением, а эфемерные сборки блокирующие, но короткие.</p>
<p><strong>DATAS</strong> (Dynamic Adaptation To Application Sizes) появился в .NET 8 и с .NET 9 включён по умолчанию для Server GC: число куч подстраивается под реальную нагрузку. Это решило проблему контейнеров, где сервис под маленькой нагрузкой в поде с большим лимитом CPU создавал много куч и съедал память. GC учитывает лимиты cgroups, а жёсткий потолок кучи задаётся <code>GCHeapHardLimit</code>/<code>GCHeapHardLimitPercent</code>. Режим переключается в csproj (<code>ServerGarbageCollection</code>), в <code>runtimeconfig.json</code> или переменной <code>DOTNET_gcServer</code>.</p>
</details>
<details><summary>«Как работает финализатор и почему его не стоит писать?»</summary>
<p>Объект с финализатором при создании регистрируется в <strong>finalization queue</strong> — уже выделение дороже. Когда он становится недостижимым, GC его не освобождает, а переносит в очередь <strong>f-reachable</strong>, которая является корнем. Значит, объект и всё, на что он ссылается, переживают сборку и продвигаются в следующее поколение. Отдельный finalizer thread вызывает финализаторы, и только следующая сборка этого поколения освобождает память.</p>
<p>Минусы: жизнь объекта продлевается минимум на одну сборку, часто до gen2; порядок вызова не определён; поток финализации один, и зависший финализатор задерживает остальные; необработанное исключение в нём роняет процесс; в .NET Core финализаторы не вызываются при завершении процесса.</p>
<p>Поэтому финализатор — только страховочная сетка для неуправляемого ресурса. В современном коде сырой хэндл оборачивают в <code>SafeHandle</code> — у него уже есть критический финализатор и подсчёт ссылок, защищающий от закрытия хэндла посреди P/Invoke-вызова и handle recycling. Свой финализатор тогда не нужен вовсе.</p>
</details>
<details><summary>«Когда нужен полный Dispose pattern?»</summary>
<p>Только когда класс <strong>напрямую владеет неуправляемым ресурсом</strong> (сырой <code>IntPtr</code>) и при этом не запечатан, то есть у него могут быть наследники. Схема: публичный <code>Dispose()</code> вызывает <code>Dispose(true)</code> и <code>GC.SuppressFinalize(this)</code>, чтобы объект не попал в f-reachable; <code>protected virtual Dispose(bool disposing)</code> идемпотентен, при <code>disposing == true</code> освобождает управляемые <code>IDisposable</code>-поля, а неуправляемое — всегда; финализатор вызывает <code>Dispose(false)</code> и управляемые поля не трогает, потому что они могли быть уже финализированы.</p>
<p>В остальных случаях всё проще: сырой хэндл — в <code>SafeHandle</code>; <code>sealed</code>-класс, владеющий только управляемыми <code>IDisposable</code>, — простой <code>Dispose()</code>, вызывающий их <code>Dispose()</code>. После освобождения методы бросают <code>ObjectDisposedException.ThrowIf(_disposed, this)</code>. Если освобождение требует I/O (сбросить буфер, закрыть соединение) — <code>IAsyncDisposable</code> с <code>await using</code>, общая логика в <code>DisposeAsyncCore()</code>. И ловушка DI: transient <code>IDisposable</code>, полученный из корневого провайдера, контейнер держит до конца жизни приложения.</p>
</details>
<details><summary>«Бывают ли утечки памяти в .NET? Как их искать?»</summary>
<p>Бывают: GC собирает только недостижимое, а утечка — это объект, который <strong>достижим, хотя больше не нужен</strong>. Типичные причины:</p>
<ul><li>события: долгоживущий издатель держит делегат, делегат держит подписчика через <code>Target</code>;</li><li>статические «кеши» без вытеснения;</li><li>замыкания в долгоживущем месте, захватившие <code>this</code> или большой буфер;</li><li><code>CancellationToken.Register</code> и linked token sources на долгоживущем токене без <code>Dispose</code>;</li><li>активные таймеры с колбэком, держащим граф объектов;</li><li>captive dependency: синглтон, захвативший scoped <code>DbContext</code>;</li><li>неограниченные очереди и каналы, куда пишут быстрее, чем читают.</li></ul>
<p>Ищу так: <code>dotnet-counters</code> показывает, что куча растёт и не возвращается после full GC; затем снимаю два дампа кучи с интервалом (<code>dotnet-gcdump</code>, dotMemory), сравниваю, какие типы растут, и смотрю <strong>retention path</strong> до корня — именно он говорит, кто держит объект.</p>
</details>
<details><summary>«Как снизить паузы GC?»</summary>
<p>Главное — <strong>меньше выделять на горячих путях</strong>, потому что каждый байт приближает следующую сборку:</p>
<ul><li>не упаковывать struct и не использовать non-generic коллекции;</li><li>не создавать замыкания в горячих циклах, использовать <code>static</code>-лямбды и кешировать делегаты;</li><li>задавать ёмкость <code>List</code>, <code>Dictionary</code>, <code>StringBuilder</code>;</li><li><code>Span&lt;T&gt;</code> вместо <code>Substring</code>/<code>Split</code>, <code>ArrayPool</code> для больших буферов, <code>ObjectPool</code> для дорогих объектов;</li><li><code>ValueTask</code> там, где метод часто завершается синхронно;</li><li>source-generated <code>System.Text.Json</code> и потоковое чтение.</li></ul>
<p>Второе — правильный профиль жизни: избегать <strong>mid-life crisis</strong>, когда объекты доживают до gen2 и там умирают, и временных объектов в LOH. Третье — выбор режима: Server GC с DATAS для сервисов, <code>SustainedLowLatency</code> для чувствительных участков, <code>GC.TryStartNoGCRegion</code> для коротких критичных окон. И всё это после измерений: <code>dotnet-counters</code> (время в GC, скорость аллокаций, сборки по поколениям), <code>dotnet-trace</code>/PerfView, <code>[MemoryDiagnoser]</code>.</p>
</details>
<details><summary>«Может ли объект быть собран до конца метода, в котором он используется?»</summary>
<p>Да. В Release JIT сообщает GC, какие локальные переменные ещё «живы» в данной точке метода, и если переменная дальше не используется, объект становится недостижимым раньше конца метода — даже если формально переменная ещё в области видимости. В Debug время жизни обычно растягивают до конца метода, поэтому поведение отличается.</p>
<p>Опасно это для объектов с финализатором, освобождающим нативный ресурс, пока нативный код ещё с ним работает: финализатор может закрыть хэндл посреди вызова. Защита — <code>GC.KeepAlive(obj)</code> после последнего нативного обращения (он просто удерживает ссылку до этой точки) или, лучше, <code>SafeHandle</code>, который удерживает себя на время P/Invoke через подсчёт ссылок. Обратная сторона того же эффекта — <code>System.Threading.Timer</code>, на который никто не ссылается, может быть собран и молча перестать тикать.</p>
</details>` },
    { id: `span`, title: `Span, Memory и работа без аллокаций`, html: `<h3>Зачем вообще Span</h3>
<p>Типичная задача бэкенда — разобрать что-то: строку из CSV, заголовок HTTP, сообщение из Kafka, штрихкод с префиксом. «Наивный» код делает <code>Split</code>, <code>Substring</code>, <code>Trim</code> — и каждая операция выделяет новую строку или массив. На одном запросе это незаметно, на сотнях тысяч сообщений в секунду это гигабайты мусора и постоянные сборки. <strong><code>Span&lt;T&gt;</code></strong> позволяет работать с <strong>непрерывным участком памяти</strong> — частью массива, строки, стековым буфером или нативной памятью — не копируя его.</p>
<p><code>Span&lt;T&gt;</code> — это <code>ref struct</code> из двух полей: управляемой ссылки (<code>ref T</code>) на начало участка и длины. Срез (<code>span.Slice(start, length)</code> или <code>span[2..5]</code>) — это просто новый Span с другим началом и длиной, операция O(1) без аллокаций. Индексация проверяет границы, так что Span безопасен, в отличие от указателей. <code>ReadOnlySpan&lt;T&gt;</code> — версия только для чтения; строка неявно приводится к <code>ReadOnlySpan&lt;char&gt;</code>, и множество API BCL принимают спаны: <code>int.Parse</code>, <code>Guid.TryParse</code>, <code>Encoding.GetBytes</code>, <code>Stream.Read</code>, методы <code>MemoryExtensions</code> (<code>IndexOf</code>, <code>Trim</code>, <code>StartsWith</code>, <code>SequenceEqual</code>).</p>
<pre><code>// Сумма чисел из строки "12,7,40" без единой аллокации
static int SumCsv(ReadOnlySpan&lt;char&gt; line)
{
    int sum = 0;
    while (!line.IsEmpty)
    {
        int comma = line.IndexOf(',');
        ReadOnlySpan&lt;char&gt; part = comma &lt; 0 ? line : line[..comma];
        sum += int.Parse(part);
        line = comma &lt; 0 ? ReadOnlySpan&lt;char&gt;.Empty : line[(comma + 1)..];
    }
    return sum;
}

int total = SumCsv("12,7,40"); // string неявно превращается в ReadOnlySpan&lt;char&gt;</code></pre>
<h3>Почему Span — ref struct и что из этого следует</h3>
<p>Span может указывать на стековую память (<code>stackalloc</code>) или внутрь объекта в куче (на середину массива). Отсюда ограничения <code>ref struct</code>, и каждое имеет причину:</p>
<ul><li><strong>Нельзя положить в поле класса или обычной структуры, в статическое поле, в массив.</strong> Иначе Span пережил бы кадр стека, на память которого указывает, — получилась бы висячая ссылка. Кроме того, GC не умеет отслеживать «внутренние» управляемые ссылки, лежащие в куче.</li><li><strong>Нельзя упаковать и привести к <code>object</code> или интерфейсу</strong> — упаковка означает кучу.</li><li><strong>Нельзя захватить в лямбду или локальную функцию-делегат</strong> — захват превращает переменную в поле класса-замыкания.</li><li><strong>Нельзя держать через <code>await</code> или <code>yield</code></strong> — локальная переменная стала бы полем state machine в куче. С C# 13 <code>ref struct</code>-локальные переменные разрешены в async- и iterator-методах, но только если они не пересекают <code>await</code>/<code>yield</code>.</li><li><strong>Нельзя использовать как generic-аргумент</strong> — до C# 13 вообще никак, с C# 13 только для параметров, помеченных анти-ограничением <code>where T : allows ref struct</code>. В C# 13 же <code>ref struct</code> научились реализовывать интерфейсы, но привести такую структуру к интерфейсу по-прежнему нельзя — использовать её можно только через generic с <code>allows ref struct</code>.</li><li>Есть и вторая причина «только стек»: Span — две машинных величины (ссылка и длина). Если бы Span мог лежать в общей памяти, конкурентная запись из двух потоков могла бы его «порвать» (tearing) — ссылка от одного, длина от другого, — и проверка границ перестала бы защищать.</li></ul>
<p>C# 11 добавил <strong>ref-поля</strong> в <code>ref struct</code> (так теперь устроен сам <code>Span&lt;T&gt;</code>) и ключевое слово <strong><code>scoped</code></strong>, которым можно пообещать компилятору, что ссылка не покинет метод. Компилятор проверяет всё это статически (ref safety rules), поэтому ошибки вы увидите при компиляции, а не в рантайме.</p>
<h3><code>Memory&lt;T&gt;</code>: Span, который можно хранить</h3>
<p>Раз Span нельзя пронести через <code>await</code>, для асинхронного кода есть <strong><code>Memory&lt;T&gt;</code></strong> и <code>ReadOnlyMemory&lt;T&gt;</code> — обычные структуры (не ref struct), которые хранят ссылку на владельца памяти (массив, строку или <code>MemoryManager&lt;T&gt;</code>), смещение и длину. Их можно класть в поля, передавать в async-методы, хранить в коллекциях. Когда нужна сама работа с данными — берут <code>.Span</code> на короткий синхронный участок.</p>
<pre><code>public async Task&lt;int&gt; ReadMessageAsync(Stream stream, Memory&lt;byte&gt; buffer, CancellationToken ct)
{
    int read = await stream.ReadAsync(buffer, ct);   // Memory живёт через await
    return Checksum(buffer.Span[..read]);             // Span — для синхронной обработки
}

static int Checksum(ReadOnlySpan&lt;byte&gt; data)
{
    int sum = 0;
    foreach (byte b in data) sum += b;
    return sum;
}</code></pre>
<p>Правило выбора: <strong>синхронный метод принимает <code>Span</code>/<code>ReadOnlySpan</code></strong>, асинхронный или хранящий данные — <code>Memory</code>/<code>ReadOnlyMemory</code>. Принимать <code>ReadOnlySpan&lt;T&gt;</code> предпочтительнее, чем <code>Span&lt;T&gt;</code>, если метод не пишет — так в него можно передать и строку, и массив.</p>
<h3>stackalloc</h3>
<p><code>stackalloc</code> выделяет буфер в кадре стека текущего метода. С появлением Span это делается без <code>unsafe</code>:</p>
<pre><code>Span&lt;byte&gt; buffer = stackalloc byte[128];</code></pre>
<p>Память освобождается при выходе из метода, GC её не видит. Правила безопасного использования:</p>
<ul><li><strong>маленькие и ограниченные размеры</strong> (сотни байт, единицы килобайт). Размер стека потока конечен, а <code>StackOverflowException</code> нельзя перехватить — процесс просто падает;</li><li><strong>никогда не выделять размер, пришедший извне</strong>, без верхней границы;</li><li><strong>не делать <code>stackalloc</code> в цикле</strong>: память освобождается не на итерации, а только при выходе из метода;</li><li>память по умолчанию обнуляется; атрибут <code>[SkipLocalsInit]</code> отключает обнуление (быстрее, но буфер содержит мусор).</li></ul>
<p>Стандартный приём — стек для маленьких размеров, пул для больших:</p>
<pre><code>const int StackLimit = 256;
byte[]? rented = null;
Span&lt;byte&gt; buffer = length &lt;= StackLimit
    ? stackalloc byte[StackLimit]
    : (rented = ArrayPool&lt;byte&gt;.Shared.Rent(length));
try
{
    buffer = buffer[..length];
    Fill(buffer);
}
finally
{
    if (rented is not null)
        ArrayPool&lt;byte&gt;.Shared.Return(rented);
}</code></pre>
<h3>ArrayPool и MemoryPool</h3>
<p><code>ArrayPool&lt;T&gt;.Shared</code> — потокобезопасный пул массивов. <code>Rent(n)</code> возвращает массив <strong>длиной не меньше n</strong> (часто больше: размеры округляются до корзин-степеней двойки), <code>Return(array)</code> возвращает его в пул. Правила, нарушение которых даёт самые неприятные баги — тихую порчу данных, а не исключение:</p>
<ul><li>работать только с первыми <code>n</code> элементами, а не с <code>array.Length</code>;</li><li>массив из пула <strong>не обнулён</strong> и может содержать чужие данные; для секретов — <code>Return(array, clearArray: true)</code>;</li><li>после <code>Return</code> массив использовать нельзя: его уже мог взять другой поток;</li><li>не возвращать массив дважды и не возвращать чужой массив;</li><li>возвращать в <code>finally</code>.</li></ul>
<p>Внутри <code>Shared</code>-пул держит небольшие кеши на поток и на ядро, поэтому <code>Rent</code>/<code>Return</code> очень дешёвы. Если нужен пул с другими лимитами — <code>ArrayPool&lt;T&gt;.Create(maxArrayLength, maxArraysPerBucket)</code>.</p>
<p><code>MemoryPool&lt;T&gt;.Shared.Rent()</code> возвращает <code>IMemoryOwner&lt;T&gt;</code> — объект-владелец с <code>Memory&lt;T&gt;</code> внутри; память возвращается в пул через <code>Dispose()</code>. Это явная модель владения: кто держит <code>IMemoryOwner</code>, тот и отвечает за освобождение, а остальные получают только <code>Memory&lt;T&gt;</code>.</p>
<h3>ref returns, ref locals и CollectionsMarshal</h3>
<p>Метод может вернуть <strong>ссылку</strong> на элемент, а не копию:</p>
<pre><code>static ref int FindMax(Span&lt;int&gt; data)
{
    int idx = 0;
    for (int i = 1; i &lt; data.Length; i++)
        if (data[i] &gt; data[idx]) idx = i;
    return ref data[idx];
}

int[] values = { 3, 9, 4 };
ref int max = ref FindMax(values);
max = 0;                      // меняется сам элемент массива
Console.WriteLine(values[1]); // 0</code></pre>
<p>Нельзя вернуть ссылку на локальную переменную метода — компилятор не даст. Практические применения в BCL:</p>
<ul><li><code>CollectionsMarshal.AsSpan(list)</code> — Span поверх внутреннего массива <code>List&lt;T&gt;</code>, быстрый проход без enumerator. Нельзя добавлять и удалять элементы списка, пока используете этот Span: при росте список заменит массив, и Span будет смотреть на старый.</li><li><code>CollectionsMarshal.GetValueRefOrAddDefault(dictionary, key, out bool exists)</code> — ссылка на значение в словаре, с добавлением при отсутствии. Подсчёт частот без двойного поиска:</li></ul>
<pre><code>var counts = new Dictionary&lt;string, int&gt;();
foreach (var word in words)
{
    ref int count = ref CollectionsMarshal.GetValueRefOrAddDefault(counts, word, out _);
    count++;   // один поиск вместо TryGetValue + индексатор
}</code></pre>
<p>Пока держите такую ссылку, словарь менять нельзя по той же причине.</p>
<h3>System.IO.Pipelines коротко</h3>
<p>При разборе потокового протокола (TCP, длинные HTTP-тела) классический код со <code>Stream</code> страдает от одних и тех же проблем: сообщение может прийти частями, буфер приходится выделять и увеличивать самостоятельно, копировать «хвост» недочитанного сообщения, а медленный потребитель никак не тормозит быстрого производителя. <strong>System.IO.Pipelines</strong> решает это: <code>Pipe</code> состоит из <code>PipeWriter</code> и <code>PipeReader</code>, память берётся из пула, данные приходят как <code>ReadOnlySequence&lt;byte&gt;</code> (возможно, из нескольких сегментов), и есть встроенный <strong>backpressure</strong> — писатель приостанавливается, если в трубе накопилось больше порога. На Pipelines построен Kestrel.</p>
<pre><code>async Task ReadLinesAsync(PipeReader reader)
{
    while (true)
    {
        ReadResult result = await reader.ReadAsync();
        ReadOnlySequence&lt;byte&gt; buffer = result.Buffer;

        while (TryReadLine(ref buffer, out ReadOnlySequence&lt;byte&gt; line))
            ProcessLine(line);

        // всё до buffer.Start обработано, всё до buffer.End просмотрено:
        // следующий ReadAsync вернёт управление, только когда придут новые данные
        reader.AdvanceTo(buffer.Start, buffer.End);

        if (result.IsCompleted) break;
    }
    await reader.CompleteAsync();
}

static bool TryReadLine(ref ReadOnlySequence&lt;byte&gt; buffer, out ReadOnlySequence&lt;byte&gt; line)
{
    SequencePosition? eol = buffer.PositionOf((byte)'\\n');
    if (eol is null) { line = default; return false; }
    line = buffer.Slice(0, eol.Value);
    buffer = buffer.Slice(buffer.GetPosition(1, eol.Value));
    return true;
}</code></pre>
<p>Ключевой момент — <code>AdvanceTo(consumed, examined)</code>: два аргумента позволяют сказать «я разобрал вот до сюда, а просмотрел всё, и мне нужно больше данных». Для удобного разбора <code>ReadOnlySequence&lt;byte&gt;</code> есть <code>SequenceReader&lt;T&gt;</code>.</p>
<h3>Когда это всё нужно</h3>
<p>Span, пулы и Pipelines — инструменты для <strong>горячих путей</strong>: парсеры, сериализаторы, обработка сообщений из очереди с высоким RPS, middleware, библиотеки. В обычном CRUD-эндпоинте, где запрос в базу занимает миллисекунды, экономия десятка аллокаций ничего не даст, а читаемость пострадает. Senior-ответ: «сначала профилирую и меряю (BenchmarkDotNet, <code>[MemoryDiagnoser]</code>, dotnet-counters), оптимизирую то, что видно в профиле».</p>
<h3>Что спросят на собеседовании</h3>
<details><summary>«Что такое Span&lt;T&gt; и чем он лучше Substring?»</summary>
<p><code>Span&lt;T&gt;</code> — это окно на <strong>непрерывный участок памяти</strong>: часть массива, строки, стековый буфер или нативную память. Устроен как <code>ref struct</code> из двух полей — управляемая ссылка на начало и длина. Срез (<code>Slice</code> или <code>span[2..5]</code>) — новый Span с другим началом и длиной, O(1) и без аллокаций; индексация проверяет границы, так что это безопасно, в отличие от указателей.</p>
<p><code>Substring</code>, <code>Split</code>, <code>Trim</code> каждый раз выделяют новые строки и массивы. Для одного запроса это неважно, но при разборе сотен тысяч сообщений в секунду это гигабайты мусора и частые сборки. С <code>ReadOnlySpan&lt;char&gt;</code> разбор CSV-строки или заголовка идёт без единой аллокации: строка неявно приводится к спану, а <code>int.Parse</code>, <code>Guid.TryParse</code>, <code>Encoding.GetBytes</code> и методы <code>MemoryExtensions</code> (<code>IndexOf</code>, <code>Trim</code>, <code>StartsWith</code>) принимают спаны напрямую.</p>
<p>И одно правило API: если метод не пишет, принимайте <code>ReadOnlySpan&lt;T&gt;</code> — тогда в него можно передать и строку, и массив.</p>
</details>
<details><summary>«Почему Span нельзя хранить в поле или использовать через await?»</summary>
<p>Потому что Span может указывать на стек (<code>stackalloc</code>) или внутрь объекта в куче, и поэтому он <code>ref struct</code>. Каждое ограничение защищает от конкретной проблемы:</p>
<ul><li>поле класса, статическое поле, массив, boxing, приведение к интерфейсу — Span пережил бы кадр стека, на который указывает, и получилась бы висячая ссылка; к тому же GC не умеет отслеживать такие внутренние ссылки, лежащие в куче;</li><li>захват в лямбду и переживание <code>await</code>/<code>yield</code> — переменная стала бы полем замыкания или state machine, то есть ушла бы в кучу;</li><li>Span — две машинных величины, и в общей памяти конкурентная запись могла бы его «порвать» (tearing): ссылка от одного значения, длина от другого — и проверка границ перестала бы защищать.</li></ul>
<p>Всё это проверяется компилятором статически (ref safety rules). Послабления в новых версиях: с C# 13 <code>ref struct</code> можно объявлять в async- и iterator-методах, если они не пересекают <code>await</code>/<code>yield</code>, и подставлять в generic с <code>where T : allows ref struct</code>. Если данные нужно пронести через <code>await</code> — берут <code>Memory&lt;T&gt;</code>.</p>
</details>
<details><summary>«Чем Memory&lt;T&gt; отличается от Span&lt;T&gt;?»</summary>
<p><code>Memory&lt;T&gt;</code> — обычная структура, не ref struct: она хранит ссылку на владельца памяти (массив, строку или <code>MemoryManager&lt;T&gt;</code>), смещение и длину. Поэтому её можно класть в поля и коллекции и передавать через <code>await</code>. Указывать на стек она не может — именно это и делает её «хранимой». Для самой работы с данными берут <code>.Span</code> на короткий синхронный участок.</p>
<pre><code>int read = await stream.ReadAsync(buffer, ct);   // Memory&lt;byte&gt; живёт через await
return Checksum(buffer.Span[..read]);             // Span — для синхронной обработки</code></pre>
<p>Правило выбора: синхронный метод принимает <code>Span</code>/<code>ReadOnlySpan</code>, асинхронный или хранящий данные — <code>Memory</code>/<code>ReadOnlyMemory</code>. Span чуть дешевле в доступе, Memory — гибче по времени жизни.</p>
</details>
<details><summary>«Как правильно использовать ArrayPool?»</summary>
<p><code>ArrayPool&lt;T&gt;.Shared</code> — потокобезопасный пул с кешами на поток и на ядро, поэтому <code>Rent</code>/<code>Return</code> очень дешёвы. Но ошибки с ним дают не исключение, а тихую порчу данных, так что правила важны:</p>
<ul><li><code>Rent(n)</code> возвращает массив <strong>не меньше</strong> n — размеры округляются до корзин, работаем только с первыми n элементами, а не с <code>Length</code>;</li><li>массив <strong>не обнулён</strong> и может содержать чужие данные; для секретов — <code>Return(array, clearArray: true)</code>;</li><li><code>Return</code> — в <code>finally</code>;</li><li>после <code>Return</code> массив не трогаем: его уже мог взять другой поток;</li><li>не возвращаем дважды и не возвращаем чужие массивы.</li></ul>
<p>Если нужны другие лимиты — <code>ArrayPool&lt;T&gt;.Create(maxArrayLength, maxArraysPerBucket)</code>. Если нужна явная модель владения, особенно в async-коде, — <code>MemoryPool&lt;T&gt;.Shared.Rent()</code>, который отдаёт <code>IMemoryOwner&lt;T&gt;</code>: кто держит владельца, тот и вызывает <code>Dispose</code>, остальные получают только <code>Memory&lt;T&gt;</code>.</p>
</details>
<details><summary>«Какие опасности у stackalloc?»</summary>
<p><code>stackalloc</code> выделяет буфер в кадре стека; с Span это делается без <code>unsafe</code>, а GC эту память не видит. Опасности:</p>
<ul><li>стек потока конечен, а <code>StackOverflowException</code> <strong>нельзя перехватить</strong> — процесс просто падает. Поэтому только маленькие и ограниченные размеры, и никогда размер, пришедший извне, без верхней границы;</li><li>в цикле нельзя: память освобождается не на итерации, а при выходе из метода;</li><li>с <code>[SkipLocalsInit]</code> буфер не обнуляется и содержит мусор — быстрее, но читать его до записи нельзя.</li></ul>
<p>Стандартный приём — «стек для маленьких, пул для больших»:</p>
<pre><code>byte[]? rented = null;
Span&lt;byte&gt; buffer = length &lt;= 256
    ? stackalloc byte[256]
    : (rented = ArrayPool&lt;byte&gt;.Shared.Rent(length));
try { Fill(buffer[..length]); }
finally { if (rented is not null) ArrayPool&lt;byte&gt;.Shared.Return(rented); }</code></pre>
</details>
<details><summary>«Что такое ref return и где он полезен?»</summary>
<p>Метод может вернуть не копию значения, а <strong>ссылку на него</strong> — например на элемент массива или спана; вызывающий через <code>ref int x = ref Find(...)</code> меняет сам элемент. Компилятор не даст вернуть ссылку на локальную переменную метода. Для больших структур это ещё и экономия на копировании; есть вариант <code>ref readonly</code> для доступа только на чтение.</p>
<p>Самые практичные применения — <code>CollectionsMarshal</code>:</p>
<ul><li><code>AsSpan(list)</code> — Span поверх внутреннего массива <code>List&lt;T&gt;</code>, проход без enumerator;</li><li><code>GetValueRefOrAddDefault(dict, key, out exists)</code> — ссылка на значение в словаре с добавлением при отсутствии: подсчёт частот одним поиском вместо <code>TryGetValue</code> + индексатор.</li></ul>
<p>Цена — ответственность: пока держите такую ссылку или Span, нельзя менять коллекцию. При росте <code>List</code> заменит внутренний массив, словарь перестроит записи, и ссылка будет смотреть на старую память.</p>
</details>
<details><summary>«Слышали про System.IO.Pipelines?»</summary>
<p>Да, это библиотека для разбора потоковых протоколов, на которой построен Kestrel. Она решает типичные проблемы кода на <code>Stream</code>: сообщение приходит частями, буфер приходится выделять и растить самому, копировать «хвост» недочитанного сообщения, а медленный потребитель никак не тормозит производителя.</p>
<p><code>Pipe</code> — это <code>PipeWriter</code> и <code>PipeReader</code>; память берётся из пула, данные приходят как <code>ReadOnlySequence&lt;byte&gt;</code>, возможно из нескольких сегментов, и есть встроенный <strong>backpressure</strong>: писатель приостанавливается, если в трубе накопилось больше порога. Ключевой метод — <code>reader.AdvanceTo(consumed, examined)</code>: «разобрал до сюда, просмотрел всё, нужно больше данных» — тогда следующий <code>ReadAsync</code> вернёт управление только при поступлении новых байтов, без холостых циклов. Для удобного разбора последовательности есть <code>SequenceReader&lt;T&gt;</code>. В прикладном коде я бы взял это для своего TCP-протокола или разбора больших тел, а не для обычного эндпоинта.</p>
</details>
<details><summary>«Когда всё это стоит применять, а когда нет?»</summary>
<p>Span, пулы, <code>stackalloc</code> и Pipelines — инструменты для <strong>горячих путей</strong>: парсеры, сериализаторы, обработчики сообщений из очереди с высоким RPS, middleware, библиотеки. В обычном CRUD-эндпоинте, где запрос к базе занимает миллисекунды, экономия десятка аллокаций ничего не даст, а читаемость и риск ошибок (использование массива после <code>Return</code>, переполнение стека) вырастут.</p>
<p>Поэтому senior-подход такой: сначала профилирую и меряю — BenchmarkDotNet с <code>[MemoryDiagnoser]</code>, <code>dotnet-counters</code> для скорости аллокаций и времени в GC, профилировщик аллокаций — и оптимизирую только то, что реально видно в профиле. Хороший пример оправданного применения — разбор штрихкодов или CSV в цикле обработки миллионов сообщений.</p>
</details>` },
    { id: `generics`, title: `Generics, делегаты и замыкания`, html: `<h3>Reification: generics существуют в рантайме</h3>
<p>В Java generics реализованы через <strong>стирание типов</strong> (type erasure): после компиляции <code>List&lt;Integer&gt;</code> и <code>List&lt;String&gt;</code> — один и тот же <code>List</code> объектов, а <code>Integer</code> упакован. В .NET generics <strong>реифицированы</strong>: рантайм знает, что <code>List&lt;int&gt;</code> и <code>List&lt;string&gt;</code> — разные закрытые типы. Отсюда:</p>
<ul><li><code>List&lt;int&gt;</code> хранит <code>int</code> прямо в массиве, без упаковки;</li><li><code>typeof(T)</code>, <code>is T</code>, <code>new T()</code> и <code>default(T)</code> работают в рантайме;</li><li>через reflection можно получить <code>typeof(List&lt;&gt;)</code> и построить <code>MakeGenericType(typeof(int))</code>;</li><li><strong>статические поля — отдельные для каждого закрытого типа</strong>: <code>Cache&lt;int&gt;.Value</code> и <code>Cache&lt;string&gt;.Value</code> — разные поля. На этом построены приёмы вроде <code>Array.Empty&lt;T&gt;()</code> и <code>EqualityComparer&lt;T&gt;.Default</code>: generic static class как кеш «по типу», без словаря.</li></ul>
<pre><code>static class TypeCache&lt;T&gt;
{
    public static readonly string Name = typeof(T).Name; // вычисляется один раз на каждый T
}
Console.WriteLine(TypeCache&lt;int&gt;.Name);    // Int32
Console.WriteLine(TypeCache&lt;string&gt;.Name); // String</code></pre>
<h3>Как JIT компилирует generic-код</h3>
<p>Это любимый вопрос на senior-уровне. JIT поступает по-разному для ссылочных и значимых аргументов:</p>
<ul><li><strong>Для reference types код разделяется.</strong> Все ссылки одного размера и одинаково обрабатываются GC, поэтому <code>List&lt;string&gt;</code>, <code>List&lt;Order&gt;</code> и <code>List&lt;object&gt;</code> используют <strong>одну копию машинного кода</strong>, скомпилированную для условного типа <code>System.__Canon</code>. Когда такому коду нужен конкретный тип (<code>typeof(T)</code>, приведение, <code>new T()</code>, вызов статического метода <code>T</code>), он находит его через <strong>runtime lookup</strong> в «generic dictionary» — небольшая косвенность.</li><li><strong>Для value types код специализируется.</strong> <code>List&lt;int&gt;</code>, <code>List&lt;long&gt;</code> и <code>List&lt;Guid&gt;</code> получают <strong>отдельные копии кода</strong>: размер элемента разный, и только так можно обойтись без упаковки. Зато в специализированном коде T известен точно, и JIT делает всё, что умеет: инлайнит вызовы <code>IEquatable&lt;T&gt;.Equals</code> у структуры, убирает ветки вроде <code>if (typeof(T) == typeof(int))</code> как константные. Этим приёмом пользуется сама BCL в горячих местах.</li></ul>
<p>Цена специализации — рост объёма машинного кода; цена разделения — косвенные обращения. Для NativeAOT это важно: все инстанциации над value types компилятор должен увидеть заранее.</p>
<h3>Ограничения (constraints)</h3>
<ul><li><code>where T : class</code> / <code>class?</code> — ссылочный тип; <code>where T : struct</code> — non-nullable value type; <code>where T : notnull</code>;</li><li><code>where T : unmanaged</code> — value type без ссылок внутри (можно брать указатель, <code>sizeof</code>, класть в <code>stackalloc</code>);</li><li><code>where T : new()</code> — есть конструктор без параметров. Исторически <code>new T()</code> компилируется через <code>Activator.CreateInstance&lt;T&gt;()</code>, что медленнее прямого <code>new</code>; в горячем пути лучше передать фабрику <code>Func&lt;T&gt;</code>;</li><li><code>where T : BaseClass</code>, <code>where T : IInterface</code>, <code>where T : U</code> (другой параметр типа);</li><li><code>where T : allows ref struct</code> (C# 13) — <strong>анти-ограничение</strong>: разрешает подставить <code>ref struct</code>, а компилятор следит, чтобы T использовался по правилам ref struct;</li><li><strong>static abstract члены интерфейсов</strong> (C# 11) позволяют требовать статические методы и операторы — на этом построена generic math:</li></ul>
<pre><code>static T Sum&lt;T&gt;(IEnumerable&lt;T&gt; values) where T : INumber&lt;T&gt;
{
    T total = T.Zero;
    foreach (var v in values) total += v;   // оператор + из интерфейса
    return total;
}
Sum(new[] { 1, 2, 3 });        // 6
Sum(new[] { 1.5m, 2.5m });     // 4.0</code></pre>
<p>Ограничения дают не только проверки, но и производительность: метод <code>Compare&lt;T&gt;(T a, T b) where T : IComparable&lt;T&gt;</code> вызывает <code>a.CompareTo(b)</code> без упаковки для struct, а версия с параметром <code>IComparable</code> упаковывала бы.</p>
<h3>Вариантность: in и out</h3>
<p>Вариантность — возможность использовать <code>Generic&lt;Derived&gt;</code> там, где ждут <code>Generic&lt;Base&gt;</code>, или наоборот. В .NET она бывает <strong>только у интерфейсов и делегатов</strong> и <strong>только для ссылочных типов-аргументов</strong>.</p>
<ul><li><strong>Ковариантность (<code>out T</code>)</strong>: T только «выходит» из типа (возвращается). <code>IEnumerable&lt;out T&gt;</code>, <code>IReadOnlyList&lt;out T&gt;</code>, <code>Func&lt;out TResult&gt;</code>. Последовательность строк можно читать как последовательность объектов.</li><li><strong>Контравариантность (<code>in T</code>)</strong>: T только «входит» (параметр). <code>IComparer&lt;in T&gt;</code>, <code>IEqualityComparer&lt;in T&gt;</code>, <code>Action&lt;in T&gt;</code>. Сравниватель объектов может сравнивать строки.</li><li><strong>Инвариантность</strong>: классы (<code>List&lt;T&gt;</code>) и интерфейсы, где T и входит, и выходит (<code>IList&lt;T&gt;</code>).</li></ul>
<pre><code>IEnumerable&lt;object&gt; objs = new List&lt;string&gt;();   // OK: ковариантность
Action&lt;object&gt; printAny = o =&gt; Console.WriteLine(o);
Action&lt;string&gt; printString = printAny;           // OK: контравариантность
// List&lt;object&gt; list = new List&lt;string&gt;();       // ошибка: List&lt;T&gt; инвариантен
// IEnumerable&lt;object&gt; nums = new List&lt;int&gt;();   // ошибка: вариантность не работает для value types</code></pre>
<p>Почему не для value types: вариантность — это переиспользование того же объекта под другим статическим типом без преобразования. Ссылка на строку и ссылка на object — одно и то же в памяти, а <code>int</code> и <code>object</code> — нет: потребовалась бы упаковка каждого элемента.</p>
<p>Отдельно стоит знать <strong>ковариантность массивов</strong> — наследие ранних версий, и она небезопасна:</p>
<pre><code>object[] arr = new string[2];  // компилируется
arr[0] = 42;                   // ArrayTypeMismatchException в рантайме</code></pre>
<p>Чтобы поймать такую запись, рантайм проверяет тип при каждой записи ссылки в массив с не-sealed типом элементов — небольшая скрытая цена.</p>
<h3>Делегаты</h3>
<p>Делегат — объект класса, производного от <code>MulticastDelegate</code>, который хранит ссылку на метод и, для экземплярного метода, <strong>ссылку на целевой объект</strong> (<code>Target</code>). Поэтому делегат на метод экземпляра удерживает этот экземпляр от сборки. Вызов делегата — косвенный вызов, JIT обычно не может его заинлайнить (с Dynamic PGO иногда может — через guarded devirtualization).</p>
<p><strong>Multicast</strong>: <code>+=</code> создаёт <strong>новый</strong> делегат со списком вызовов (делегаты неизменяемы). При вызове методы выполняются по порядку; если делегат возвращает значение, вы получите <strong>результат последнего</strong>; исключение в одном обработчике <strong>прерывает</strong> вызов оставшихся. Если нужно вызвать всех независимо или собрать результаты — <code>GetInvocationList()</code> и цикл. <code>BeginInvoke</code>/<code>EndInvoke</code> у делегатов в .NET Core не поддерживаются.</p>
<p>Встроенные <code>Func&lt;...&gt;</code>, <code>Action&lt;...&gt;</code>, <code>Predicate&lt;T&gt;</code> покрывают почти всё; собственный делегат стоит объявлять, когда нужны <code>ref</code>/<code>out</code>-параметры или говорящее имя в публичном API.</p>
<h3>События</h3>
<p><code>event</code> — это не отдельный вид объекта, а <strong>ограничение доступа</strong> к полю-делегату: снаружи класса можно только подписаться (<code>+=</code>) и отписаться (<code>-=</code>), а вызвать событие или присвоить ему значение может только сам класс. Для «field-like» событий компилятор генерирует <code>add</code>/<code>remove</code> с атомарным обновлением через <code>Interlocked.CompareExchange</code>, так что подписка из разных потоков безопасна.</p>
<pre><code>public class StockService
{
    public event EventHandler&lt;StockChangedEventArgs&gt;? StockChanged;

    protected virtual void OnStockChanged(StockChangedEventArgs e)
        =&gt; StockChanged?.Invoke(this, e);  // поле читается один раз — нет гонки с отпиской
}</code></pre>
<p><code>?.Invoke</code> важен: поле читается в локальную копию, и если другой поток отпишет последний обработчик между проверкой и вызовом, <code>NullReferenceException</code> не будет. Но обработчик всё ещё может быть вызван сразу после отписки — с этим нужно жить. Асинхронные обработчики событий — это <code>async void</code> со всеми его проблемами (см. главу про async).</p>
<h3>Замыкания и захват переменных</h3>
<p>Лямбда, использующая внешнюю локальную переменную, <strong>захватывает саму переменную, а не её значение</strong>. Компилятор переносит такую переменную в поле сгенерированного класса (display class, в IL его имя вроде <code>&lt;&gt;c__DisplayClass0_0</code>), а тело лямбды делает методом этого класса. И внешний код, и лямбда работают с одним полем — изменения видны в обе стороны.</p>
<pre><code>int counter = 0;
Action inc = () =&gt; counter++;
inc(); inc();
Console.WriteLine(counter); // 2 — лямбда изменила «локальную» переменную</code></pre>
<p><strong>Ловушка захвата в цикле:</strong></p>
<pre><code>var actions = new List&lt;Action&gt;();
for (int i = 0; i &lt; 3; i++)
    actions.Add(() =&gt; Console.Write(i));
foreach (var a in actions) a();   // 333</code></pre>
<p>Переменная <code>i</code> объявлена в заголовке <code>for</code> — она <strong>одна на весь цикл</strong>. Все три лямбды захватили её, и к моменту вызова она равна 3. Исправление — копия внутри тела: <code>int copy = i; actions.Add(() =&gt; Console.Write(copy));</code> — тогда на каждой итерации создаётся новая переменная и новый экземпляр замыкания, вывод <code>012</code>. В <code>foreach</code> начиная с C# 5 переменная итерации <strong>новая на каждой итерации</strong>, поэтому <code>foreach (var x in new[] {0,1,2}) actions.Add(() =&gt; Console.Write(x));</code> печатает <code>012</code>. Тот же эффект бывает в <code>Task.Run</code> внутри <code>for</code> и в LINQ-запросах, выполняемых позже.</p>
<h3>Сколько стоит лямбда</h3>
<ul><li><strong>Лямбда без захвата</strong> (<code>x =&gt; x * 2</code>): компилятор кеширует делегат в статическом поле — он создаётся один раз и потом переиспользуется. Аллокаций на вызов нет.</li><li><strong>Лямбда, захватывающая только <code>this</code></strong>: замыкание не нужно, но <strong>новый делегат</strong> выделяется при каждом выполнении выражения.</li><li><strong>Лямбда с захватом локальных переменных</strong>: выделяется <strong>экземпляр display class</strong> и <strong>делегат</strong>. Важная тонкость: display class создаётся при входе в область видимости, где объявлена захваченная переменная, — <strong>даже если ветка с лямбдой не выполнится</strong>. Метод с редким <code>if (error) Log(() =&gt; ...)</code> платит аллокацией на каждом вызове; лечится выносом редкой ветки в отдельный метод.</li><li><strong><code>static</code>-лямбда</strong> (C# 9): <code>static x =&gt; x * 2</code> — компилятор запрещает захват, и случайная аллокация становится ошибкой компиляции.</li><li><strong>Method group</strong> (<code>list.ForEach(Print)</code>): до C# 11 каждый раз создавался новый делегат; с C# 11 для статических методов он кешируется.</li><li><strong>Локальная функция</strong>, которую вызывают напрямую (не превращая в делегат), передаёт захваченные переменные через структуру по ссылке — аллокации нет. Это частая причина выбрать локальную функцию вместо лямбды.</li><li>Многие API принимают «состояние» отдельным аргументом, чтобы лямбда могла быть статической: <code>ConcurrentDictionary.GetOrAdd(key, static (k, arg) =&gt; ..., arg)</code>, <code>string.Create(length, state, static (span, s) =&gt; ...)</code>.</li></ul>
<h3>Что спросят на собеседовании</h3>
<details><summary>«Чем generics в C# отличаются от Java?»</summary>
<p>В Java generics сделаны через <strong>type erasure</strong>: после компиляции <code>List&lt;Integer&gt;</code> и <code>List&lt;String&gt;</code> — один и тот же <code>List</code> объектов, а примитивы упакованы. В .NET generics <strong>реифицированы</strong>: рантайм знает, что <code>List&lt;int&gt;</code> и <code>List&lt;string&gt;</code> — разные закрытые типы.</p>
<p>Отсюда практические следствия:</p>
<ul><li><code>List&lt;int&gt;</code> хранит <code>int</code> прямо в массиве, без упаковки;</li><li><code>typeof(T)</code>, <code>is T</code>, <code>new T()</code>, <code>default(T)</code> работают в рантайме, через reflection можно построить <code>typeof(List&lt;&gt;).MakeGenericType(typeof(int))</code>;</li><li>статические поля свои у каждого закрытого типа — на этом построены кеши «по типу» без словаря: <code>Array.Empty&lt;T&gt;()</code>, <code>EqualityComparer&lt;T&gt;.Default</code>, собственный <code>TypeCache&lt;T&gt;</code>.</li></ul>
</details>
<details><summary>«Как JIT компилирует generic-код?»</summary>
<p>По-разному для ссылочных и значимых аргументов.</p>
<ul><li><strong>Reference types — общий код.</strong> Все ссылки одного размера и одинаково видны GC, поэтому <code>List&lt;string&gt;</code>, <code>List&lt;Order&gt;</code> и <code>List&lt;object&gt;</code> используют одну копию машинного кода, скомпилированную для <code>System.__Canon</code>. Когда коду нужен конкретный тип — <code>typeof(T)</code>, приведение, <code>new T()</code> — он берёт его через runtime lookup в generic dictionary, это небольшая косвенность.</li><li><strong>Value types — специализация.</strong> <code>List&lt;int&gt;</code>, <code>List&lt;long&gt;</code>, <code>List&lt;Guid&gt;</code> получают отдельный код, потому что размер элемента разный и иначе не обойтись без упаковки. Зато T известен точно: JIT инлайнит <code>IEquatable&lt;T&gt;.Equals</code> у структуры и выкидывает ветки вида <code>if (typeof(T) == typeof(int))</code> как константные — BCL этим пользуется в горячих местах.</li></ul>
<p>Компромисс: специализация раздувает машинный код, разделение даёт косвенные обращения. Для NativeAOT важно, что все инстанциации над value types компилятор должен увидеть заранее.</p>
</details>
<details><summary>«Что такое ковариантность и контравариантность? Почему List&lt;string&gt; нельзя присвоить List&lt;object&gt;?»</summary>
<p>Вариантность есть <strong>только у интерфейсов и делегатов</strong> и только для ссылочных аргументов.</p>
<ul><li><strong>Ковариантность</strong> (<code>out T</code>): T только возвращается — <code>IEnumerable&lt;out T&gt;</code>, <code>IReadOnlyList&lt;out T&gt;</code>, <code>Func&lt;out TResult&gt;</code>. Последовательность строк можно читать как последовательность объектов.</li><li><strong>Контравариантность</strong> (<code>in T</code>): T только принимается — <code>IComparer&lt;in T&gt;</code>, <code>Action&lt;in T&gt;</code>. Сравниватель объектов умеет сравнивать строки.</li></ul>
<p><code>List&lt;T&gt;</code> — класс, а классы инвариантны; к тому же в списке T и входит, и выходит. Если бы присваивание было разрешено, через <code>List&lt;object&gt;</code> можно было бы добавить <code>int</code> в список строк. Для value types вариантность не работает, потому что ссылка на строку и ссылка на object — одно и то же в памяти, а <code>int</code> и <code>object</code> — нет: пришлось бы упаковать каждый элемент.</p>
<p>И отдельно — <strong>ковариантность массивов</strong>, наследие ранних версий: <code>object[] arr = new string[2]; arr[0] = 42;</code> компилируется и падает с <code>ArrayTypeMismatchException</code>. Ради этого рантайм проверяет тип при каждой записи ссылки в массив с не-sealed типом элементов.</p>
</details>
<details><summary>«Что будет, если подписчик события не отпишется?»</summary>
<p>Делегат хранит ссылку на метод и на целевой объект (<code>Target</code>). Пока издатель жив и держит делегат в своём событии, подписчик достижим и не будет собран. Если издатель долгоживущий — синглтон, статическое событие, сервис уровня приложения, — каждый неотписавшийся подписчик (например, view-model или scoped-объект) становится утечкой памяти, а заодно продолжает получать уведомления и выполнять обработчики, хотя логически уже «мёртв».</p>
<p>Решения: отписываться в <code>Dispose</code>; делать подписку объектом-<code>IDisposable</code>, который отписывает при освобождении; не делать статических событий; в крайних случаях — weak event pattern. А обратная ситуация безопасна: короткоживущий издатель, на который подписан долгоживущий подписчик, утечки не создаёт — делегат держит подписчика, а не наоборот.</p>
</details>
<details><summary>«Что выведет код с лямбдами в цикле for? Чем отличается foreach?»</summary>
<pre><code>for (int i = 0; i &lt; 3; i++)
    actions.Add(() =&gt; Console.Write(i));
foreach (var a in actions) a();   // 333</code></pre>
<p>Выведет <code>333</code>. Лямбда захватывает <strong>саму переменную, а не значение</strong>: компилятор переносит <code>i</code> в поле display class. Переменная из заголовка <code>for</code> одна на весь цикл, все три лямбды смотрят на одно поле, и к моменту вызова оно равно 3.</p>
<p>Исправление — копия внутри тела: <code>int copy = i;</code> — переменная объявлена внутри итерации, поэтому на каждую итерацию создаётся новый экземпляр замыкания, и вывод будет <code>012</code>. В <code>foreach</code> с C# 5 переменная итерации новая на каждой итерации, поэтому там сразу <code>012</code>. Та же ловушка встречается с <code>Task.Run</code> внутри <code>for</code> и с ленивыми LINQ-запросами, которые выполняются позже, чем написаны.</p>
</details>
<details><summary>«Аллоцирует ли лямбда?»</summary>
<p>Зависит от того, что она захватывает:</p>
<ul><li><strong>ничего</strong> — компилятор кеширует делегат в статическом поле, аллокации только при первом использовании;</li><li><strong>только <code>this</code></strong> — замыкание не нужно, но новый делегат создаётся при каждом выполнении выражения;</li><li><strong>локальные переменные</strong> — экземпляр display class и делегат. Display class создаётся при входе в область, где объявлена захваченная переменная, даже если ветка с лямбдой не выполнится — метод с редким <code>if (error) Log(() =&gt; ...)</code> платит на каждом вызове; лечится выносом ветки в отдельный метод.</li></ul>
<p>Инструменты: <code>static</code>-лямбда (C# 9) превращает случайный захват в ошибку компиляции; API с отдельным аргументом-состоянием (<code>GetOrAdd(key, static (k, arg) =&gt; ..., arg)</code>, <code>string.Create</code>) позволяют обойтись без захвата; локальная функция, вызываемая напрямую, передаёт захваченное через структуру по ссылке без аллокации; method group для статического метода кешируется с C# 11. Всё это имеет значение в горячем пути — в обычном коде аллокация делегата не проблема.</p>
</details>
<details><summary>«Что вернёт multicast-делегат с возвращаемым значением?»</summary>
<p>Результат <strong>последнего</strong> метода в списке вызовов, остальные результаты теряются. Делегаты неизменяемы: <code>+=</code> создаёт новый делегат с расширенным списком. Методы вызываются по порядку, и исключение в одном из них <strong>прерывает</strong> вызов оставшихся.</p>
<p>Если нужно собрать все результаты или вызвать всех независимо от ошибок — перебираю <code>GetInvocationList()</code> и вызываю каждый делегат сам, с собственным <code>try/catch</code>. Ещё стоит упомянуть, что <code>BeginInvoke</code>/<code>EndInvoke</code> у делегатов в .NET Core не поддерживаются, а событие — это не отдельный объект, а ограничение доступа к полю-делегату: снаружи только <code>+=</code>/<code>-=</code>, вызывает его только сам класс, обычно через <code>?.Invoke</code>, чтобы не поймать гонку с отпиской последнего обработчика.</p>
</details>
<details><summary>«Что такое static abstract члены интерфейсов и generic math?»</summary>
<p>С C# 11 интерфейс может требовать <strong>статические</strong> члены — методы, свойства и операторы, — а generic-код может вызывать их через параметр типа: <code>T.Zero</code>, <code>a + b</code>. На этом построена generic math: интерфейсы вроде <code>INumber&lt;T&gt;</code>, которые реализуют все числовые типы BCL.</p>
<pre><code>static T Sum&lt;T&gt;(IEnumerable&lt;T&gt; values) where T : INumber&lt;T&gt;
{
    T total = T.Zero;
    foreach (var v in values) total += v;
    return total;
}</code></pre>
<p>Раньше такой метод пришлось бы писать отдельно для <code>int</code>, <code>decimal</code>, <code>double</code>. Поскольку для value types код специализируется, вызов операторов компилируется так же эффективно, как в ручной версии. Тот же принцип в более простой форме — constraint вместо интерфейсного параметра: <code>Compare&lt;T&gt;(T a, T b) where T : IComparable&lt;T&gt;</code> вызывает <code>CompareTo</code> без упаковки структуры, а версия с параметром <code>IComparable</code> упаковывала бы.</p>
</details>` },
    { id: `collections`, title: `Коллекции изнутри`, html: `<h3><code>List&lt;T&gt;</code>: динамический массив</h3>
<p><code>List&lt;T&gt;</code> — обёртка над массивом <code>T[]</code> и счётчиком <code>Count</code>. <strong>Capacity</strong> — длина внутреннего массива, Count — сколько элементов реально занято. Новый <code>List&lt;T&gt;</code> без аргументов не выделяет массив вовсе; при первом <code>Add</code> выделяется массив на 4 элемента, а когда место кончается — новый массив <strong>вдвое больше</strong>, и все элементы копируются туда.</p>
<ul><li><code>Add</code> — <strong>амортизированно O(1)</strong>: редкие дорогие копирования «размазываются» по многим дешёвым добавлениям. Но каждое удвоение — это новая аллокация, а старый массив становится мусором; при росте до больших размеров промежуточные массивы попадают в LOH.</li><li><code>Insert(0, x)</code> и <code>RemoveAt(0)</code> — O(n): сдвигаются все элементы.</li><li><code>Contains</code>, <code>IndexOf</code>, <code>Remove(item)</code> — O(n) линейный поиск.</li><li>Индексатор — O(1).</li><li>Если размер известен заранее — <code>new List&lt;T&gt;(capacity)</code> или <code>EnsureCapacity</code>; после наполнения лишнее можно отдать через <code>TrimExcess</code>.</li></ul>
<p>У списка есть поле <code>_version</code>, которое увеличивается при каждом изменении. Enumerator запоминает версию и при расхождении бросает <code>InvalidOperationException: Collection was modified</code> — поэтому нельзя удалять элементы внутри <code>foreach</code> по тому же списку. Варианты: <code>RemoveAll(predicate)</code>, проход с конца по индексу, построение нового списка.</p>
<h3><code>Dictionary&lt;TKey, TValue&gt;</code>: как устроена хэш-таблица</h3>
<p>Современная реализация — <strong>открытое хэширование с цепочками на индексах</strong> в двух массивах:</p>
<pre><code>// упрощённая схема внутренних полей
int[] _buckets;        // для каждого бакета: индекс первой записи цепочки (+1), 0 = пусто
Entry[] _entries;      // плотный массив всех записей

struct Entry
{
    public uint hashCode;  // сохранённый хэш ключа
    public int next;       // индекс следующей записи в цепочке, -1 = конец
    public TKey key;
    public TValue value;
}</code></pre>
<p><strong>Поиск</strong> (<code>TryGetValue</code>, индексатор):</p>
<ol><li>Вычисляется <code>comparer.GetHashCode(key)</code>.</li><li>Номер бакета — хэш по модулю длины <code>_buckets</code> (длина — простое число, для деления используется быстрый трюк FastMod).</li><li>По индексу из бакета берётся первая запись цепочки; для каждой записи сравниваются сначала сохранённые хэши (дёшево), и только при совпадении — <code>Equals</code> ключей.</li><li>Переход по <code>next</code>, пока не найдём или не дойдём до конца.</li></ol>
<p><strong>Добавление</strong> записывает новую запись в следующую свободную ячейку <code>_entries</code> (или в ячейку из free list — списка освобождённых удалением записей) и делает её головой цепочки своего бакета. <strong>Удаление</strong> вычёркивает запись из цепочки и кладёт ячейку в free list.</p>
<p><strong>Рост</strong>: когда <code>_entries</code> заполнен, создаются массивы размера «ближайшее простое число, не меньше удвоенного»; все записи перераспределяются по новым бакетам. Хэши заново не вычисляются — они сохранены в <code>Entry</code>. Это O(n), но амортизированно добавление остаётся O(1). Как и для списка, известный заранее размер лучше передать в конструктор.</p>
<p><strong>Почему GetHashCode так важен.</strong> В среднем поиск O(1), потому что цепочки короткие. Если хэш-функция плохая — например, у структуры не переопределён <code>GetHashCode</code>, или он возвращает константу, или учитывает только одно поле с малым числом значений, — ключи скапливаются в немногих бакетах, и поиск деградирует до <strong>O(n)</strong>: словарь превращается в связный список. Злоумышленник, умеющий подбирать коллизии, может так положить сервис (HashDoS); поэтому в .NET Core хэш строк <strong>рандомизирован на каждый процесс</strong> — <code>"abc".GetHashCode()</code> в разных запусках разный. Отсюда правило: <strong>никогда не сохраняйте <code>string.GetHashCode()</code></strong> в базу, кеш или файл — для стабильного хэша нужна явная функция (xxHash, SHA и т.п.).</p>
<p>Остальное, что стоит знать:</p>
<ul><li>ключи сравниваются через <code>IEqualityComparer&lt;TKey&gt;</code>; можно передать свой, например <code>StringComparer.OrdinalIgnoreCase</code>;</li><li><strong>мутировать ключ</strong> после добавления нельзя: запись останется в бакете старого хэша и станет ненаходимой;</li><li><strong>порядок перечисления не гарантирован</strong> (без удалений он совпадает с порядком вставки, но это деталь реализации, опираться на неё нельзя);</li><li><code>Dictionary</code> <strong>не потокобезопасен</strong> для записи: параллельные <code>Add</code> могут повредить внутреннюю структуру. Современная реализация в ряде случаев замечает это и бросает <code>InvalidOperationException</code>, но гарантий нет — в старом .NET Framework это приводило к вечным циклам и 100% CPU. Только чтение из нескольких потоков без писателей безопасно.</li><li><code>TryAdd</code> и <code>TryGetValue</code> избавляют от двойного поиска (<code>ContainsKey</code> + индексатор).</li></ul>
<p><strong><code>HashSet&lt;T&gt;</code></strong> устроен точно так же, только без значений. Его операции <code>UnionWith</code>, <code>IntersectWith</code>, <code>ExceptWith</code>, <code>Contains</code> — основной инструмент, чтобы превратить O(n·m) «вложенный поиск по списку» в O(n + m).</p>
<h3>Отсортированные коллекции</h3>
<ul><li><strong><code>SortedDictionary&lt;TKey, TValue&gt;</code></strong> — красно-чёрное дерево. Вставка, удаление, поиск — O(log n). Каждый узел — отдельный объект: больше памяти и хуже локальность кеша.</li><li><strong><code>SortedList&lt;TKey, TValue&gt;</code></strong> — два отсортированных массива (ключи и значения). Поиск — бинарный, O(log n). Вставка и удаление — <strong>O(n)</strong> из-за сдвига элементов (кроме добавления в конец по возрастанию). Зато меньше памяти, быстрый доступ по индексу (<code>Keys[i]</code>) и отличная локальность.</li><li><strong><code>SortedSet&lt;T&gt;</code></strong> — красно-чёрное дерево без значений, с <code>GetViewBetween</code>, <code>Min</code>, <code>Max</code>.</li></ul>
<p>Выбор: если данные наполняются один раз (или приходят уже отсортированными) и потом читаются — <code>SortedList</code>; если много вставок и удалений в произвольном порядке — <code>SortedDictionary</code>.</p>
<h3>Queue, Stack, LinkedList, PriorityQueue</h3>
<ul><li><strong><code>Queue&lt;T&gt;</code></strong> — кольцевой буфер на массиве: <code>Enqueue</code> и <code>Dequeue</code> O(1) (Enqueue амортизированно).</li><li><strong><code>Stack&lt;T&gt;</code></strong> — массив: <code>Push</code> и <code>Pop</code> O(1).</li><li><strong><code>LinkedList&lt;T&gt;</code></strong> — двусвязный список. Вставка и удаление по известному узлу (<code>LinkedListNode&lt;T&gt;</code>) — O(1), поиск — O(n). Каждый узел — отдельная аллокация, данные разбросаны по куче, поэтому на практике <code>List&lt;T&gt;</code> часто быстрее даже там, где «по учебнику» должен выигрывать список. Хорош для LRU-кеша в паре со словарём «ключ → узел».</li><li><strong><code>PriorityQueue&lt;TElement, TPriority&gt;</code></strong> (.NET 6) — куча (min-heap) на массиве: <code>Enqueue</code> и <code>Dequeue</code> O(log n), <code>Peek</code> O(1). Первым извлекается элемент с <strong>наименьшим</strong> приоритетом. Не потокобезопасна и не гарантирует порядок для равных приоритетов.</li></ul>
<h3>Неизменяемые и замороженные коллекции</h3>
<p>Три разных идеи, которые часто путают:</p>
<ul><li><strong>Read-only обёртки</strong> (<code>ReadOnlyCollection&lt;T&gt;</code>, <code>list.AsReadOnly()</code>, интерфейсы <code>IReadOnlyList&lt;T&gt;</code>, <code>IReadOnlyDictionary</code>): только запрещают изменение <strong>через эту ссылку</strong>. Владелец исходного списка может его менять, и изменения будут видны.</li><li><strong>Immutable-коллекции</strong> (<code>System.Collections.Immutable</code>): <code>ImmutableList&lt;T&gt;</code>, <code>ImmutableDictionary</code>, <code>ImmutableHashSet</code> построены на сбалансированных деревьях. Каждая «модификация» возвращает <strong>новую</strong> коллекцию, переиспользуя большую часть старой структуры (structural sharing), поэтому стоит O(log n), а не O(n). Безопасны для многопоточного чтения, удобны для снимков состояния. Для массового построения — <code>Builder</code> (<code>ImmutableList.CreateBuilder&lt;T&gt;()</code>).</li><li><strong><code>ImmutableArray&lt;T&gt;</code></strong> — структура-обёртка над обычным массивом: чтение такое же быстрое, как у массива, но каждая «модификация» копирует весь массив за O(n). Подходит для небольших коллекций, которые почти не меняются. Ловушка: <code>default(ImmutableArray&lt;T&gt;)</code> — неинициализированное значение, <code>IsDefault == true</code>, и обращение к нему бросает исключение.</li><li><strong>Frozen-коллекции</strong> (.NET 8, <code>System.Collections.Frozen</code>): <code>FrozenDictionary&lt;TKey, TValue&gt;</code> и <code>FrozenSet&lt;T&gt;</code>, создаются через <code>ToFrozenDictionary()</code> / <code>ToFrozenSet()</code>. Создание <strong>дорогое</strong>: коллекция анализирует ключи и выбирает специализированную стратегию (например, для строковых ключей — хэширование по части строки или по длине). Зато чтение быстрее, чем у <code>Dictionary</code>. Идеальный сценарий — справочник, построенный один раз при старте и читаемый миллионы раз: коды складов, маппинги статусов, конфигурация.</li></ul>
<h3>Concurrent-коллекции</h3>
<p><strong><code>ConcurrentDictionary&lt;TKey, TValue&gt;</code></strong> — главная из них, и её внутренности спрашивают часто:</p>
<ul><li>Бакеты — массив связных списков <strong>узлов-объектов</strong> (каждое добавление — аллокация узла, в отличие от <code>Dictionary</code>).</li><li><strong>Striped locking</strong>: есть массив объектов-блокировок (по умолчанию их число связано с количеством процессоров), и каждый замок защищает подмножество бакетов. Запись берёт <strong>один</strong> замок своего бакета, поэтому писатели в разные бакеты не мешают друг другу.</li><li><strong>Чтение без блокировок</strong>: <code>TryGetValue</code> и индексатор не берут lock вообще.</li><li>Рост таблицы и операции, которым нужен согласованный снимок — <code>Count</code>, <code>Keys</code>, <code>Values</code>, <code>ToArray</code> — берут <strong>все</strong> замки (<code>IsEmpty</code> — только если без блокировок словарь выглядит пустым). Вызывать <code>Count</code> в горячем цикле — плохая идея.</li><li><code>foreach</code> по словарю безопасен при параллельных изменениях и не бросает исключений, но это <strong>не снимок</strong>: изменения, сделанные во время перечисления, могут как попасть, так и не попасть в результат. Снимок — <code>ToArray()</code>.</li></ul>
<p><strong>Ловушка <code>GetOrAdd(key, valueFactory)</code></strong>: фабрика вызывается <strong>вне замка</strong>. Если два потока одновременно не нашли ключ, <strong>оба выполнят фабрику</strong>, но в словаре останется только одно значение, и оба вызова вернут его. Если фабрика дорогая (поход в базу) или создаёт <code>IDisposable</code> (соединение), это лишняя работа или утечка. То же касается делегатов <code>AddOrUpdate</code> — они могут выполняться повторно. Стандартное решение — хранить <code>Lazy&lt;T&gt;</code>:</p>
<pre><code>private readonly ConcurrentDictionary&lt;string, Lazy&lt;Task&lt;Warehouse&gt;&gt;&gt; _cache = new();

public Task&lt;Warehouse&gt; GetAsync(string code) =&gt;
    _cache.GetOrAdd(code, c =&gt; new Lazy&lt;Task&lt;Warehouse&gt;&gt;(
        () =&gt; LoadAsync(c), LazyThreadSafetyMode.ExecutionAndPublication)).Value;</code></pre>
<p>Лишний <code>Lazy</code> может быть создан, но <code>Value</code> вычислится один раз — у того экземпляра, который попал в словарь. (Кешировать <code>Task</code> удобно, но упавшая задача останется в кеше — её нужно удалять.) Есть перегрузка <code>GetOrAdd(key, factory, factoryArgument)</code>, которая позволяет обойтись <code>static</code>-лямбдой без замыкания.</p>
<p>Другие:</p>
<ul><li><strong><code>ConcurrentQueue&lt;T&gt;</code></strong> — lock-free очередь на связанных сегментах-массивах, FIFO.</li><li><strong><code>ConcurrentStack&lt;T&gt;</code></strong> — lock-free стек.</li><li><strong><code>ConcurrentBag&lt;T&gt;</code></strong> — неупорядоченный мешок со списками на каждый поток; эффективен, когда один и тот же поток и кладёт, и забирает (пулы объектов), и плох как очередь между производителем и потребителем.</li><li><strong><code>BlockingCollection&lt;T&gt;</code></strong> — блокирующая обёртка с ограничением размера; в новом коде её вытесняют <code>Channel&lt;T&gt;</code> (асинхронные, без блокировки потоков).</li></ul>
<h3>Сводная таблица сложностей</h3>
<table><thead><tr><th>Коллекция</th><th>Доступ по индексу или ключу</th><th>Поиск значения</th><th>Вставка</th><th>Удаление</th></tr></thead><tbody><tr><td><code>T[]</code></td><td>O(1)</td><td>O(n)</td><td>—</td><td>—</td></tr><tr><td><code>List&lt;T&gt;</code></td><td>O(1)</td><td>O(n)</td><td>O(1) амортиз. в конец, O(n) в середину</td><td>O(n)</td></tr><tr><td><code>LinkedList&lt;T&gt;</code></td><td>—</td><td>O(n)</td><td>O(1) по узлу</td><td>O(1) по узлу</td></tr><tr><td><code>Dictionary</code>, <code>HashSet</code></td><td>O(1) в среднем, O(n) худший</td><td>O(n) по значению</td><td>O(1) амортиз.</td><td>O(1)</td></tr><tr><td><code>SortedDictionary</code>, <code>SortedSet</code></td><td>O(log n)</td><td>O(n) по значению</td><td>O(log n)</td><td>O(log n)</td></tr><tr><td><code>SortedList</code></td><td>O(log n) по ключу, O(1) по индексу</td><td>O(n) по значению</td><td>O(n)</td><td>O(n)</td></tr><tr><td><code>Queue&lt;T&gt;</code>, <code>Stack&lt;T&gt;</code></td><td>—</td><td>O(n)</td><td>O(1) амортиз.</td><td>O(1)</td></tr><tr><td><code>PriorityQueue</code></td><td>O(1) Peek</td><td>—</td><td>O(log n)</td><td>O(log n) Dequeue</td></tr><tr><td><code>ImmutableList&lt;T&gt;</code></td><td>O(log n)</td><td>O(n)</td><td>O(log n)</td><td>O(log n)</td></tr><tr><td><code>ImmutableArray&lt;T&gt;</code></td><td>O(1)</td><td>O(n)</td><td>O(n)</td><td>O(n)</td></tr><tr><td><code>FrozenDictionary</code></td><td>O(1), быстрее Dictionary</td><td>O(n) по значению</td><td>только создание, дорогое</td><td>—</td></tr></tbody></table>
<h3>Что спросят на собеседовании</h3>
<details><summary>«Как устроен Dictionary? Что происходит при коллизии и при росте?»</summary>
<p>Внутри два массива: <code>_buckets</code> — для каждого бакета индекс первой записи цепочки, и плотный <code>_entries</code> — записи с сохранённым хэшем, ключом, значением и индексом <code>next</code> следующей записи в цепочке. То есть это цепочки, но не на объектах-узлах, а на индексах внутри массива — без аллокаций на элемент и с хорошей локальностью.</p>
<p><strong>Поиск</strong>: считаем <code>comparer.GetHashCode(key)</code>, берём бакет по модулю длины (длина — простое число, деление ускорено трюком FastMod), идём по цепочке через <code>next</code>, сравнивая сначала сохранённые хэши и только при совпадении — <code>Equals</code>. <strong>Коллизия</strong> — это просто ещё одна запись в той же цепочке: новая запись пишется в свободную ячейку <code>_entries</code> (или из free list после удалений) и становится головой цепочки.</p>
<p><strong>Рост</strong>: когда <code>_entries</code> заполнен, выделяются массивы размера «ближайшее простое не меньше удвоенного», и записи перераспределяются по новым бакетам — хэши не пересчитываются, они сохранены. Это O(n), но добавление остаётся амортизированно O(1). Если размер известен, передаю ёмкость в конструктор. И помню, что <code>Dictionary</code> не потокобезопасен для записи, а порядок перечисления не гарантирован.</p>
</details>
<details><summary>«Почему важны GetHashCode и Equals ключа? Что будет, если GetHashCode возвращает константу?»</summary>
<p>Средний O(1) держится на том, что цепочки короткие, а это зависит от распределения хэшей. Если <code>GetHashCode</code> возвращает константу, все ключи попадают в один бакет, цепочка становится длиной n, и каждый поиск и вставка — линейный обход с вызовом <code>Equals</code>: словарь деградирует до связного списка, <strong>O(n)</strong> на операцию и O(n²) на наполнение. Похожий эффект даёт хэш по одному полю с малым числом значений или непереопределённый <code>GetHashCode</code> у структуры.</p>
<p>Если же <code>Equals</code> и <code>GetHashCode</code> не согласованы, словарь ломается логически: равные ключи оказываются в разных бакетах, появляются дубли, поиск не находит существующий ключ. На этом же основана атака HashDoS — подбор коллизий, чтобы положить сервис, — поэтому хэш строк в .NET Core рандомизирован. Для своих типов: неизменяемые поля, <code>HashCode.Combine</code>, <code>IEquatable&lt;T&gt;</code> или <code>record</code>; либо передать свой <code>IEqualityComparer&lt;TKey&gt;</code>, например <code>StringComparer.OrdinalIgnoreCase</code>.</p>
</details>
<details><summary>«Можно ли использовать хэш строки как стабильный идентификатор?»</summary>
<p>Нет. В .NET Core <code>string.GetHashCode()</code> <strong>рандомизирован на каждый процесс</strong>: у <code>"abc"</code> в разных запусках, на разных машинах и у разных экземпляров сервиса хэш разный. Сделано это ради защиты от HashDoS — злоумышленник не может заранее подобрать строки с одинаковым хэшем.</p>
<p>Поэтому <code>GetHashCode</code> нельзя сохранять в базу, кеш, файл или использовать для шардирования между экземплярами — после рестарта всё разъедется. Он предназначен только для хэш-таблиц внутри одного процесса. Для стабильного хэша нужна явная детерминированная функция: xxHash (например, из <code>System.IO.Hashing</code>), SHA-256, если нужна криптостойкость, или просто естественный ключ.</p>
</details>
<details><summary>«Чем List отличается от LinkedList на практике?»</summary>
<p>По учебнику <code>LinkedList&lt;T&gt;</code> выигрывает на вставке и удалении: O(1) по известному узлу против O(n) у <code>List</code> при вставке в середину. Но на практике <code>List&lt;T&gt;</code> часто быстрее даже там:</p>
<ul><li>каждый узел связного списка — отдельная аллокация с заголовком и двумя ссылками, это память и работа для GC;</li><li>узлы разбросаны по куче, и обход постоянно промахивается мимо кеша процессора, а массив читается подряд;</li><li>O(1) работает только если узел уже есть — найти его всё равно O(n).</li></ul>
<p>Сдвиг элементов в массиве — это быстрое копирование блока памяти, и для тысяч элементов оно дешевле, чем погоня по указателям. <code>LinkedList</code> я беру, когда действительно держу ссылки на узлы и часто их переставляю, — классический пример LRU-кеш в паре со словарём «ключ → узел». В остальных случаях — <code>List</code>, а для очередей — <code>Queue&lt;T&gt;</code> на кольцевом буфере.</p>
</details>
<details><summary>«SortedList или SortedDictionary?»</summary>
<p>Обе дают упорядоченный по ключу словарь с поиском O(log n), но устроены по-разному:</p>
<ul><li><code>SortedDictionary</code> — красно-чёрное дерево: вставка и удаление O(log n), но каждый узел — объект, больше памяти и хуже локальность;</li><li><code>SortedList</code> — два отсортированных массива: поиск бинарный, вставка и удаление O(n) из-за сдвига (кроме добавления в конец по возрастанию), зато меньше памяти, быстрый доступ по индексу (<code>Keys[i]</code>) и отличная локальность.</li></ul>
<p>Выбор: данные наполняются один раз или приходят уже отсортированными, а потом много читаются — <code>SortedList</code>; много вставок и удалений в произвольном порядке — <code>SortedDictionary</code>. Если упорядоченность нужна только для выдачи, иногда проще обычный <code>Dictionary</code> и сортировка при выводе.</p>
</details>
<details><summary>«Как устроены блокировки в ConcurrentDictionary? Может ли GetOrAdd вызвать фабрику дважды?»</summary>
<p>Бакеты — массив связных списков узлов-объектов, и каждое добавление выделяет узел. Запись защищена <strong>striped locking</strong>: есть массив замков, каждый отвечает за подмножество бакетов, и писатель берёт один замок своего бакета — писатели в разные бакеты не мешают друг другу. <strong>Чтение</strong> (<code>TryGetValue</code>, индексатор) идёт вообще без блокировок. Рост таблицы и операции, требующие согласованного снимка — <code>Count</code>, <code>Keys</code>, <code>Values</code>, <code>ToArray</code>, — берут все замки, так что <code>Count</code> в горячем цикле — плохая идея. <code>foreach</code> безопасен, но это не снимок.</p>
<p>Да, фабрика может выполниться дважды: <code>GetOrAdd(key, factory)</code> вызывает её <strong>вне замка</strong>, и если два потока одновременно не нашли ключ, оба выполнят фабрику, в словаре останется одно значение, и оба получат его. Для дорогих фабрик (поход в базу) или создающих <code>IDisposable</code> это лишняя работа или утечка. Решение — хранить <code>Lazy&lt;T&gt;</code>:</p>
<pre><code>_cache.GetOrAdd(code, c =&gt; new Lazy&lt;Task&lt;Warehouse&gt;&gt;(
    () =&gt; LoadAsync(c), LazyThreadSafetyMode.ExecutionAndPublication)).Value;</code></pre>
<p>Лишний <code>Lazy</code> может создаться, но <code>Value</code> вычислится один раз. Нюанс — упавший <code>Task</code> останется в кеше, его надо удалять. Для полноценного кеша с защитой от stampede есть <code>HybridCache</code>.</p>
</details>
<details><summary>«Чем ReadOnlyCollection отличается от ImmutableList и от FrozenDictionary?»</summary>
<ul><li><strong><code>ReadOnlyCollection&lt;T&gt;</code></strong> и <code>IReadOnlyList&lt;T&gt;</code> — только запрет изменения <strong>через эту ссылку</strong>. Владелец исходного списка может его менять, и изменения будут видны; это не снимок и не потокобезопасность.</li><li><strong><code>ImmutableList&lt;T&gt;</code></strong> — действительно неизменяемая коллекция на сбалансированном дереве: «модификация» возвращает новую коллекцию, переиспользуя большую часть старой (structural sharing), за O(log n). Безопасна для многопоточного чтения, хороша для снимков состояния; массово строить через <code>Builder</code>. Если нужна скорость чтения массива и изменений почти нет — <code>ImmutableArray&lt;T&gt;</code>, у которого любое изменение копирует всё за O(n), и нужно помнить про <code>IsDefault</code>.</li><li><strong><code>FrozenDictionary</code></strong> (.NET 8) — неизменяемый словарь, оптимизированный под чтение: при создании он анализирует ключи и выбирает стратегию (для строк, например, хэширует по части строки или по длине). Создание дорогое, чтение быстрее <code>Dictionary</code>. Идеален для справочника, построенного при старте и читаемого миллионы раз.</li></ul>
<p>Коротко: read-only — про доступ, immutable — про дешёвые новые версии, frozen — про максимально быстрое чтение неизменных данных.</p>
</details>
<details><summary>«Почему нельзя менять List внутри foreach?»</summary>
<p>У <code>List&lt;T&gt;</code> есть поле <code>_version</code>, которое увеличивается при каждом изменении. Enumerator запоминает версию в начале перечисления и на каждом <code>MoveNext</code> сверяет её; при расхождении бросает <code>InvalidOperationException: Collection was modified</code>. Это защита: после удаления или вставки индексы сдвигаются, и перечисление пропустило бы элементы или прошло бы по одному дважды.</p>
<p>Варианты, если нужно удалить по условию: <code>list.RemoveAll(predicate)</code> — один проход O(n); цикл <code>for</code> с конца по индексу; построение нового списка через <code>Where(...).ToList()</code>. Удалять по одному через <code>Remove</code> в цикле — O(n²), этого тоже стоит избегать.</p>
</details>
<details><summary>«Как бы вы реализовали LRU-кеш?»</summary>
<p>Классическая схема — <code>Dictionary&lt;TKey, LinkedListNode&lt;Entry&gt;&gt;</code> плюс <code>LinkedList&lt;Entry&gt;</code>, где список упорядочен по давности использования:</p>
<ul><li><code>Get</code>: находим узел в словаре за O(1), переносим его в голову списка — это O(1), потому что узел известен;</li><li><code>Put</code>: если ключ есть — обновляем значение и переносим в голову; если нет — добавляем узел в голову и в словарь, а при превышении ёмкости удаляем хвост списка и его ключ из словаря.</li></ul>
<p>Это тот редкий случай, когда <code>LinkedList</code> оправдан: мы храним ссылки на узлы и постоянно их переставляем. Для многопоточного доступа операции нужно защищать одним <code>lock</code> — две коллекции должны меняться согласованно, <code>ConcurrentDictionary</code> тут не поможет. А в продакшене я бы сначала посмотрел на готовое: <code>MemoryCache</code> с <code>SizeLimit</code> или <code>HybridCache</code>, а не писал своё.</p>
</details>` },
    { id: `linq`, title: `LINQ изнутри`, html: `<h3>Отложенное и немедленное выполнение</h3>
<p>Главное, что нужно понимать про LINQ to Objects: вызов <code>Where</code>, <code>Select</code>, <code>OrderBy</code> <strong>ничего не вычисляет</strong>. Он возвращает объект-итератор, который помнит источник и делегат. Работа происходит, только когда кто-то перечисляет результат: <code>foreach</code>, <code>ToList()</code>, <code>Count()</code>, <code>First()</code>.</p>
<pre><code>var list = new List&lt;int&gt; { 1, 2, 3 };
var query = list.Where(x =&gt; x &gt; 1);   // запрос описан, но не выполнен
list.Add(4);
Console.WriteLine(string.Join(",", query)); // 2,3,4 — видим элемент, добавленный после</code></pre>
<p>Операторы делятся на группы:</p>
<table><thead><tr><th>Группа</th><th>Операторы</th><th>Поведение</th></tr></thead><tbody><tr><td>Отложенные потоковые</td><td><code>Where</code>, <code>Select</code>, <code>SelectMany</code>, <code>Take</code>, <code>Skip</code>, <code>Concat</code>, <code>Zip</code>, <code>Cast</code>, <code>OfType</code></td><td>обрабатывают по одному элементу по мере перечисления</td></tr><tr><td>Отложенные буферизующие</td><td><code>OrderBy</code>, <code>ThenBy</code>, <code>GroupBy</code>, <code>Reverse</code>, <code>Join</code> (буферизует внутреннюю последовательность)</td><td>откладываются до перечисления, но при первом <code>MoveNext</code> читают источник целиком</td></tr><tr><td>Немедленные</td><td><code>ToList</code>, <code>ToArray</code>, <code>ToDictionary</code>, <code>ToHashSet</code>, <code>Count</code>, <code>Sum</code>, <code>Min</code>, <code>Max</code>, <code>Average</code>, <code>First</code>, <code>Single</code>, <code>Any</code>, <code>All</code>, <code>Contains</code>, <code>Aggregate</code></td><td>выполняют запрос сразу</td></tr></tbody></table>
<p><code>Distinct</code> формально потоковый (отдаёт элементы по мере обнаружения новых), но держит множество всех увиденных — память O(n).</p>
<p>Следствия отложенного выполнения:</p>
<ul><li><strong>захваченные переменные читаются в момент перечисления</strong>, а не в момент описания запроса: если <code>threshold</code> изменился между <code>Where(x =&gt; x &gt; threshold)</code> и <code>foreach</code>, используется новое значение;</li><li><strong>исключения возникают при перечислении</strong> — стек вызовов указывает на <code>foreach</code> или <code>ToList</code>, а не на строку, где написан <code>Select</code>; это сбивает с толку при отладке;</li><li>исключение из правила: проверки аргументов самих методов LINQ (<code>Where(null)</code>) выполняются сразу, потому что BCL отделяет валидацию от итератора (см. ниже про <code>yield</code>).</li></ul>
<h3>Множественное перечисление</h3>
<p>Если запрос перечислить дважды, он <strong>выполнится дважды</strong> — со всеми побочными эффектами, обращениями к базе и HTTP-вызовами.</p>
<pre><code>IEnumerable&lt;Order&gt; orders = LoadOrders();   // ленивый источник: yield, запрос к БД, файл

if (orders.Any())                            // первое перечисление
    Process(orders.ToList());                // второе перечисление: источник читается заново</code></pre>
<p>Решение — материализовать один раз (<code>var list = orders.ToList();</code>), если результат нужен несколько раз, и принимать в методах <code>IReadOnlyCollection&lt;T&gt;</code>/<code>IReadOnlyList&lt;T&gt;</code>, когда метод действительно должен проходить коллекцию несколько раз. Rider и анализаторы подсвечивают «possible multiple enumeration» — на собеседовании полезно сказать, что вы такие предупреждения не игнорируете. Обратная крайность — <code>ToList()</code> после каждого оператора «на всякий случай» — тоже плоха: лишние аллокации и потеря ленивости.</p>
<h3>IEnumerable против IQueryable</h3>
<p>Внешне одинаковые вызовы означают совсем разное:</p>
<ul><li><code>Enumerable.Where(this IEnumerable&lt;T&gt;, Func&lt;T, bool&gt;)</code> получает <strong>скомпилированный делегат</strong> и выполняет его в памяти для каждого элемента.</li><li><code>Queryable.Where(this IQueryable&lt;T&gt;, Expression&lt;Func&lt;T, bool&gt;&gt;)</code> получает <strong>дерево выражения</strong> — описание кода в виде данных. Провайдер (EF Core) обходит это дерево и транслирует его в SQL.</li></ul>
<p>Одна и та же лямбда <code>o =&gt; o.Status == OrderStatus.Shipped</code> компилируется в делегат или в <code>Expression</code> в зависимости от того, какой тип ожидает параметр. Отсюда классическая ошибка:</p>
<pre><code>public IEnumerable&lt;Order&gt; GetAll() =&gt; _db.Orders;     // тип возврата — IEnumerable

var shipped = repo.GetAll()
    .Where(o =&gt; o.Status == OrderStatus.Shipped)      // Enumerable.Where!
    .Take(10)
    .ToList();
// SQL: SELECT * FROM orders — вся таблица уходит в память, фильтр и Take — на клиенте</code></pre>
<p>Пока у переменной статический тип <code>IQueryable&lt;T&gt;</code>, операторы дописывают дерево выражения, и в базу уходит один запрос с <code>WHERE</code> и <code>LIMIT</code>. Как только тип стал <code>IEnumerable&lt;T&gt;</code> — явно через <code>AsEnumerable()</code> или неявно через тип возврата, — всё дальнейшее выполняется в памяти. Иногда это делают сознательно: отфильтровать в базе, затем <code>AsEnumerable()</code> и применить то, что SQL выразить не может.</p>
<p>Особенности деревьев выражений и EF Core:</p>
<ul><li>в дереве нельзя использовать произвольные методы: вызов вашей функции внутри <code>Where</code> EF Core не переведёт в SQL и бросит <code>InvalidOperationException</code> («could not be translated»). Автоматическое выполнение на клиенте EF Core делает только в финальной проекции <code>Select</code>;</li><li>захваченные переменные становятся <strong>параметрами</strong> SQL-запроса, а литералы — константами; параметры позволяют базе переиспользовать план;</li><li>дерево можно построить вручную через <code>Expression.Lambda</code>, <code>Expression.Equal</code> и т.д. (динамические фильтры) и скомпилировать в делегат через <code>Compile()</code> — это дорого, результат нужно кешировать.</li></ul>
<h3>yield и iterator state machines</h3>
<p>Метод с <code>yield return</code> компилятор превращает в класс, реализующий <code>IEnumerable&lt;T&gt;</code> и <code>IEnumerator&lt;T&gt;</code>: поле состояния, текущее значение, все локальные переменные и параметры — тоже поля, а тело метода переписано в <code>MoveNext()</code> с <code>switch</code> по состоянию. Каждый <code>yield return</code> — точка, где <code>MoveNext</code> возвращает <code>true</code> и запоминает, откуда продолжить.</p>
<pre><code>static IEnumerable&lt;int&gt; Evens(int max)
{
    Console.WriteLine("start");
    for (int i = 0; i &lt;= max; i += 2)
        yield return i;
    Console.WriteLine("end");
}

var seq = Evens(4);          // ничего не напечатано: тело ещё не выполнялось
foreach (var x in seq.Take(2))
    Console.WriteLine(x);    // start, 0, 2 — «end» не будет: Take остановился раньше</code></pre>
<p>Важные свойства итераторов:</p>
<ul><li><strong>ленивость</strong>: тело не выполняется до первого <code>MoveNext</code>;</li><li><strong>отложенная валидация аргументов</strong> — классическая ловушка:</li></ul>
<pre><code>static IEnumerable&lt;string&gt; ReadLines(string path)
{
    if (path is null) throw new ArgumentNullException(nameof(path)); // не выполнится при вызове!
    foreach (var line in File.ReadLines(path)) yield return line;
}

var lines = ReadLines(null);  // исключения нет
// ...исключение вылетит где-то позже, при первом foreach</code></pre>
<p>Исправление — разделить метод на обычный (проверка) и итератор (работа), например через локальную функцию:</p>
<pre><code>static IEnumerable&lt;string&gt; ReadLines(string path)
{
    ArgumentNullException.ThrowIfNull(path);   // выполнится сразу
    return Iterate(path);

    static IEnumerable&lt;string&gt; Iterate(string p)
    {
        foreach (var line in File.ReadLines(p)) yield return line;
    }
}</code></pre>
<ul><li><strong><code>finally</code> и <code>using</code> внутри итератора выполняются при <code>Dispose()</code> перечислителя</strong>. <code>foreach</code> вызывает <code>Dispose</code> и при досрочном <code>break</code>, поэтому файл в примере выше будет закрыт. Если же перечислять вручную через <code>GetEnumerator()</code> и не вызвать <code>Dispose</code>, ресурсы останутся открытыми.</li><li><code>yield return</code> нельзя писать внутри <code>try</code>, у которого есть <code>catch</code> (внутри <code>try</code>/<code>finally</code> можно), и нельзя в <code>finally</code>.</li><li>Асинхронный аналог — <code>async IAsyncEnumerable&lt;T&gt;</code> с <code>yield return</code> и <code>await foreach</code> (см. главу про async).</li></ul>
<h3>Типичные ловушки производительности</h3>
<ul><li><strong><code>Count() &gt; 0</code> вместо <code>Any()</code></strong> на ленивой последовательности: <code>Count()</code> пройдёт всё, <code>Any()</code> остановится на первом элементе. Для <code>ICollection&lt;T&gt;</code> <code>Count()</code> берёт свойство <code>Count</code> за O(1), но у <code>List&lt;T&gt;</code> проще сразу обратиться к свойству. В EF Core <code>Any()</code> превращается в <code>EXISTS</code>, а <code>Count()</code> — в <code>COUNT(*)</code>.</li><li><strong>Поиск по списку внутри цикла или <code>Where</code></strong>: <code>orders.Where(o =&gt; ids.Contains(o.Id))</code>, где <code>ids</code> — <code>List</code>, это O(n·m). Сделайте <code>HashSet</code>, а для соединения двух коллекций по ключу — <code>ToDictionary</code>, <code>ToLookup</code> или <code>Join</code> (он строит хэш-таблицу внутренней последовательности).</li><li><strong><code>First</code>/<code>Single</code> в цикле</strong> по большой коллекции — то же O(n·m).</li><li><strong><code>Single</code> вместо <code>First</code></strong>: <code>Single</code> обязан убедиться, что второго элемента нет, и в памяти дочитывает последовательность дальше, а в SQL запрашивает две строки.</li><li><strong><code>Last()</code>, <code>ElementAt()</code>, <code>Count()</code> на ленивом источнике</strong> — полный проход.</li><li><strong>LINQ в горячем пути</strong>: каждый оператор — объект-итератор, каждая лямбда с захватом — замыкание и делегат, перечисление через интерфейсы — виртуальные вызовы. В обычном коде это не важно; в цикле на миллион итераций, вызываемом на каждом запросе, обычный <code>for</code> заметно выгоднее. Рантайм с каждой версией оптимизирует LINQ (специальные пути для массивов и списков, объединение <code>Where</code>+<code>Select</code>), но аллокации замыканий остаются на вашей стороне.</li><li><strong><code>Distinct</code>, <code>GroupBy</code>, <code>ToDictionary</code> для своих типов</strong> требуют корректных <code>Equals</code>/<code>GetHashCode</code> — или используйте <code>DistinctBy</code> (.NET 6) и передачу <code>IEqualityComparer&lt;T&gt;</code>.</li><li><strong><code>OrderBy(...).OrderBy(...)</code></strong> — второй вызов пересортирует всё заново; для вторичного ключа нужен <code>ThenBy</code>.</li><li><strong>Модификация коллекции внутри запроса</strong> по ней же — <code>InvalidOperationException</code>.</li></ul>
<h3>Новые операторы, которые полезно знать</h3>
<ul><li>.NET 6: <code>Chunk(size)</code> (разбиение на пачки — удобно для батчей в базу или Kafka), <code>DistinctBy</code>, <code>UnionBy</code>, <code>IntersectBy</code>, <code>ExceptBy</code>, <code>MinBy</code>, <code>MaxBy</code>, <code>TryGetNonEnumeratedCount</code>, <code>Take(range)</code>.</li><li>.NET 7: <code>Order()</code> и <code>OrderDescending()</code> без селектора ключа.</li><li>.NET 9: <code>CountBy(keySelector)</code> и <code>AggregateBy</code> — группировка с подсчётом без промежуточных групп; <code>Index()</code> — пары (индекс, элемент).</li><li>.NET 10: <code>LeftJoin</code> и <code>RightJoin</code>, которые раньше выражались через <code>GroupJoin</code> + <code>SelectMany</code> + <code>DefaultIfEmpty</code>; LINQ для <code>IAsyncEnumerable&lt;T&gt;</code> вошёл в стандартную библиотеку (<code>System.Linq.AsyncEnumerable</code>).</li></ul>
<h3>Что спросят на собеседовании</h3>
<details><summary>«Что такое отложенное выполнение? Какие операторы немедленные?»</summary>
<p><code>Where</code>, <code>Select</code>, <code>OrderBy</code> ничего не вычисляют: они возвращают объект-итератор, который помнит источник и делегат. Работа начинается, когда результат перечисляют. Поэтому:</p>
<pre><code>var query = list.Where(x =&gt; x &gt; 1);
list.Add(4);
string.Join(",", query); // "2,3,4" — элемент, добавленный после описания, виден</code></pre>
<p>Операторы делятся на три группы:</p>
<ul><li><strong>отложенные потоковые</strong> — <code>Where</code>, <code>Select</code>, <code>SelectMany</code>, <code>Take</code>, <code>Skip</code>: обрабатывают по элементу;</li><li><strong>отложенные буферизующие</strong> — <code>OrderBy</code>, <code>GroupBy</code>, <code>Reverse</code>, <code>Join</code> (буферизует внутреннюю последовательность): ждут перечисления, но при первом <code>MoveNext</code> читают источник целиком;</li><li><strong>немедленные</strong> — <code>ToList</code>, <code>ToArray</code>, <code>ToDictionary</code>, <code>Count</code>, <code>Sum</code>, <code>First</code>, <code>Single</code>, <code>Any</code>, <code>All</code>, <code>Aggregate</code>.</li></ul>
<p>Следствия: захваченные переменные читаются в момент перечисления, а исключения возникают в <code>foreach</code> или <code>ToList</code>, а не в строке с <code>Select</code>, — это путает при отладке. Проверки аргументов самих операторов (<code>Where(null)</code>) при этом срабатывают сразу.</p>
</details>
<details><summary>«Чем опасно множественное перечисление?»</summary>
<p>Ленивый запрос, перечисленный дважды, <strong>выполняется дважды</strong> — со всеми побочными эффектами. Если источник — <code>yield</code>-метод, файл, запрос к базе или HTTP-вызов, это двойная работа, а иногда и разные результаты: между двумя проходами данные изменились, и <code>Any()</code> сказал «есть», а <code>ToList()</code> вернул пусто.</p>
<pre><code>if (orders.Any())              // первое перечисление
    Process(orders.ToList());  // второе: источник читается заново</code></pre>
<p>Решение — материализовать один раз, если результат нужен несколько раз, и в сигнатурах принимать <code>IReadOnlyCollection&lt;T&gt;</code>/<code>IReadOnlyList&lt;T&gt;</code>, когда метод действительно проходит коллекцию несколько раз; <code>IEnumerable&lt;T&gt;</code> — когда один. Предупреждения Rider и анализаторов «possible multiple enumeration» я не игнорирую. Но и обратная крайность — <code>ToList()</code> после каждого оператора — плоха: лишние аллокации и потеря ленивости.</p>
</details>
<details><summary>«В чём разница между IEnumerable и IQueryable?»</summary>
<p><code>Enumerable.Where</code> принимает <code>Func&lt;T, bool&gt;</code> — скомпилированный делегат, который выполняется в памяти для каждого элемента. <code>Queryable.Where</code> принимает <code>Expression&lt;Func&lt;T, bool&gt;&gt;</code> — дерево выражения, то есть описание кода в виде данных, которое провайдер (EF Core) транслирует в SQL. Одна и та же лямбда компилируется в одно или другое в зависимости от ожидаемого типа параметра.</p>
<p>Классическая ошибка — репозиторий с типом возврата <code>IEnumerable&lt;Order&gt;</code>:</p>
<pre><code>public IEnumerable&lt;Order&gt; GetAll() =&gt; _db.Orders;
repo.GetAll().Where(o =&gt; o.Status == Shipped).Take(10).ToList();
// SELECT * FROM orders — фильтр и Take выполняются в памяти</code></pre>
<p>Пока статический тип — <code>IQueryable&lt;T&gt;</code>, операторы дописывают дерево, и в базу уходит один запрос с <code>WHERE</code> и <code>LIMIT</code>. Как только тип стал <code>IEnumerable&lt;T&gt;</code> — через тип возврата или <code>AsEnumerable()</code>, — дальше всё на клиенте. Иногда это делают сознательно: отфильтровать в базе, потом <code>AsEnumerable()</code> и применить то, что SQL не выражает. Ещё стоит сказать, что захваченные переменные становятся параметрами SQL, а литералы — константами, и параметры позволяют базе переиспользовать план.</p>
</details>
<details><summary>«Во что компилируется yield?»</summary>
<p>Метод с <code>yield return</code> компилятор превращает в класс, реализующий <code>IEnumerable&lt;T&gt;</code> и <code>IEnumerator&lt;T&gt;</code>. Поле состояния, текущее значение, локальные переменные и параметры становятся полями, а тело метода переписывается в <code>MoveNext()</code> со <code>switch</code> по состоянию: каждый <code>yield return</code> — точка, где <code>MoveNext</code> возвращает <code>true</code> и запоминает, откуда продолжить.</p>
<p>Свойства, которые из этого следуют:</p>
<ul><li>тело не выполняется до первого <code>MoveNext</code> — отсюда отложенная валидация аргументов;</li><li>если потребитель остановился раньше (<code>Take(2)</code>), код после цикла не выполнится;</li><li><code>finally</code> и <code>using</code> внутри итератора выполняются при <code>Dispose()</code> перечислителя — <code>foreach</code> вызывает его и при <code>break</code>, а ручной <code>GetEnumerator()</code> без <code>Dispose</code> оставит ресурсы открытыми;</li><li><code>yield return</code> нельзя писать в <code>try</code> с <code>catch</code> и в <code>finally</code>.</li></ul>
<p>Асинхронный аналог — <code>async IAsyncEnumerable&lt;T&gt;</code> и <code>await foreach</code>.</p>
</details>
<details><summary>«Почему проверка аргумента в итераторе не срабатывает при вызове?»</summary>
<p>Потому что всё тело iterator-метода, включая проверку в первой строке, переезжает в <code>MoveNext()</code>. Вызов <code>ReadLines(null)</code> просто создаёт объект-итератор, и исключение вылетит где-то позже, при первом <code>foreach</code> — далеко от места ошибки, со стеком, указывающим не туда.</p>
<p>Исправление — разделить метод на обычный, который проверяет аргументы сразу, и итератор, который делает работу. Удобно через локальную функцию:</p>
<pre><code>static IEnumerable&lt;string&gt; ReadLines(string path)
{
    ArgumentNullException.ThrowIfNull(path);   // выполнится сразу
    return Iterate(path);

    static IEnumerable&lt;string&gt; Iterate(string p)
    {
        foreach (var line in File.ReadLines(p)) yield return line;
    }
}</code></pre>
<p>Именно так BCL устроена внутри LINQ, поэтому <code>Where(null)</code> бросает сразу. Та же ловушка есть у async-методов: исключение до первого <code>await</code> всё равно попадает в задачу, и приём разделения там такой же.</p>
</details>
<details><summary>«Any() или Count() &gt; 0?»</summary>
<p><code>Any()</code>. На ленивой последовательности <code>Count()</code> пройдёт её целиком, а <code>Any()</code> остановится на первом элементе. Для <code>ICollection&lt;T&gt;</code> <code>Count()</code> возьмёт свойство за O(1), но у <code>List&lt;T&gt;</code> проще сразу обратиться к <code>Count</code>. В EF Core разница видна в SQL: <code>Any()</code> превращается в <code>EXISTS</code>, который база прекращает на первой найденной строке, а <code>Count()</code> — в <code>COUNT(*)</code> по всем подходящим строкам.</p>
<p>Похожие ловушки: <code>Single</code> вместо <code>First</code> — <code>Single</code> обязан убедиться, что второго элемента нет, поэтому дочитывает дальше, а в SQL запрашивает две строки; <code>Last()</code> и <code>ElementAt()</code> на ленивом источнике — полный проход; <code>OrderBy().OrderBy()</code> пересортирует всё заново вместо <code>ThenBy</code>.</p>
</details>
<details><summary>«Как найти пересечение двух больших списков?»</summary>
<p>Не вложенным поиском. <code>orders.Where(o =&gt; ids.Contains(o.Id))</code>, где <code>ids</code> — <code>List</code>, — это O(n·m): на каждый заказ линейный поиск по списку. На двух коллекциях по сто тысяч элементов это десять миллиардов сравнений.</p>
<p>Правильно — построить хэш-структуру по одной из коллекций: <code>var set = ids.ToHashSet();</code>, затем <code>orders.Where(o =&gt; set.Contains(o.Id))</code> — O(n + m). Для пересечения однотипных коллекций есть <code>Intersect</code> и <code>IntersectBy</code>, которые внутри тоже строят множество, или <code>HashSet.IntersectWith</code>. Если нужно соединить по ключу и забрать данные с обеих сторон — <code>Join</code> (строит хэш-таблицу внутренней последовательности), <code>ToDictionary</code> или <code>ToLookup</code>. Для своих типов ключей нужны корректные <code>Equals</code>/<code>GetHashCode</code> или переданный <code>IEqualityComparer&lt;T&gt;</code>.</p>
</details>
<details><summary>«Что EF Core делает с непереводимым методом в Where?»</summary>
<p>Бросает <code>InvalidOperationException</code> с сообщением «could not be translated». Внутри <code>Where</code> находится дерево выражения, и EF Core может перевести в SQL только то, что знает: операторы, свойства сущностей, известные методы вроде <code>string.Contains</code> или <code>EF.Functions</code>. Вызов вашей функции он не может выполнить в базе, а молча выполнить фильтр в памяти, загрузив всю таблицу, было бы хуже.</p>
<p>Автоматическое выполнение на клиенте EF Core делает только в <strong>финальной проекции</strong> <code>Select</code>, где оно не меняет объём загружаемых строк. Варианты решения: переписать условие через переводимые конструкции; явно отфильтровать в базе всё, что можно, затем <code>AsEnumerable()</code> и применить метод в памяти — осознанно; или вынести логику в SQL-функцию с маппингом.</p>
</details>
<details><summary>«Чем LINQ плох в горячем пути?»</summary>
<p>Каждый оператор — объект-итератор, каждая лямбда с захватом — замыкание и делегат, перечисление идёт через интерфейсы — виртуальные вызовы, которые JIT не всегда может девиртуализировать. В обычном коде это пренебрежимо, но в цикле на миллион итераций, вызываемом на каждом запросе, обычный <code>for</code> или <code>foreach</code> по <code>List</code>/массиву заметно выгоднее и по времени, и по аллокациям.</p>
<p>Рантайм с каждой версией оптимизирует LINQ — специальные пути для массивов и списков, объединение <code>Where</code>+<code>Select</code>, — но аллокации замыканий остаются на вашей стороне. Поэтому позиция такая: LINQ по умолчанию ради читаемости, а переписываю на циклы только то, что видно в профиле или бенчмарке.</p>
</details>` },
    { id: `async`, title: `async/await изнутри`, html: `<h3>Зачем async на бэкенде</h3>
<p>Асинхронность в серверном коде нужна не для «скорости одного запроса», а для <strong>масштабируемости</strong>: пока запрос ждёт базу, Kafka или HTTP-сервис, поток не блокируется и возвращается в thread pool обслуживать другие запросы. Синхронный сервис на 200 одновременных медленных запросов держит 200 потоков (каждый — около мегабайта стека и переключения контекста); асинхронный обслуживает их горсткой потоков. Для CPU-bound работы <code>async</code> ничего не даёт — там нужен параллелизм.</p>
<h3>Во что компилируется async-метод</h3>
<p>Компилятор переписывает async-метод в <strong>state machine</strong>. Возьмём:</p>
<pre><code>public async Task&lt;int&gt; GetLengthAsync(string url)
{
    string html = await _http.GetStringAsync(url);
    return html.Length;
}</code></pre>
<p>Упрощённо получается:</p>
<pre><code>public Task&lt;int&gt; GetLengthAsync(string url)
{
    var sm = new GetLengthStateMachine { Owner = this, Url = url, State = -1,
                                         Builder = AsyncTaskMethodBuilder&lt;int&gt;.Create() };
    sm.Builder.Start(ref sm);   // синхронно выполняет MoveNext до первого незавершённого await
    return sm.Builder.Task;
}

struct GetLengthStateMachine : IAsyncStateMachine
{
    public MyService Owner;       // ссылка на this исходного метода
    public int State;
    public AsyncTaskMethodBuilder&lt;int&gt; Builder;
    public string Url;            // параметры и локальные переменные становятся полями
    private TaskAwaiter&lt;string&gt; _awaiter;

    public void MoveNext()
    {
        try
        {
            if (State == -1)
            {
                _awaiter = Owner._http.GetStringAsync(Url).GetAwaiter();
                if (!_awaiter.IsCompleted)
                {
                    State = 0;
                    Builder.AwaitUnsafeOnCompleted(ref _awaiter, ref this); // подписка на продолжение
                    return;                                                 // поток свободен
                }
            }
            string html = _awaiter.GetResult();  // результат или проброс исключения
            Builder.SetResult(html.Length);
        }
        catch (Exception ex)
        {
            Builder.SetException(ex);            // исключение уходит в Task
        }
    }
}</code></pre>
<p>Ключевые моменты:</p>
<ul><li>метод <strong>выполняется синхронно</strong> до первого <code>await</code>, чья задача ещё не завершена. Если всё завершилось сразу (данные в кеше), метод так и отработает синхронно, без переключения потоков;</li><li>в Release state machine — <strong>структура</strong>; при первой реальной приостановке билдер копирует её в кучу (boxing). Поэтому синхронно завершившийся async-метод почти бесплатен, а приостановившийся — стоит аллокации state machine и <code>Task</code>;</li><li><code>await</code> работает с любым типом, у которого есть <code>GetAwaiter()</code> с <code>IsCompleted</code>, <code>OnCompleted</code> и <code>GetResult()</code> — это паттерн, а не интерфейс;</li><li>через <code>await</code> протекает <strong>ExecutionContext</strong> — с ним <code>AsyncLocal&lt;T&gt;</code> (на этом построены <code>Activity.Current</code>, scope логгера, ambient-контексты);</li><li><code>Task</code> для частых результатов рантайм кеширует (завершённые задачи для <code>true</code>/<code>false</code>, небольших целых, <code>null</code>), а для произвольных значений выделяет новую.</li></ul>
<h3>Task и ValueTask</h3>
<p><code>Task&lt;T&gt;</code> — класс, то есть аллокация на каждый вызов, если результат не взят из кеша. <code>ValueTask&lt;T&gt;</code> — структура, которая содержит <strong>либо готовый результат, либо <code>Task&lt;T&gt;</code>, либо <code>IValueTaskSource&lt;T&gt;</code></strong> (переиспользуемый объект из пула — так сделаны сокеты и Pipelines). Выигрыш — когда метод <strong>часто завершается синхронно</strong>: кеш-хит, данные уже в буфере.</p>
<p>Правила <code>ValueTask</code>, нарушение которых даёт неопределённое поведение:</p>
<ul><li><strong>await только один раз</strong> — после завершения объект-источник может уже обслуживать другую операцию;</li><li><strong>не ждать конкурентно</strong> из нескольких мест;</li><li><strong>не вызывать <code>.Result</code> / <code>.GetAwaiter().GetResult()</code>, пока операция не завершена</strong>;</li><li>если нужно что-то из этого — сразу превратить в задачу: <code>.AsTask()</code>;</li><li>не хранить в полях и не складывать в коллекции «на потом».</li></ul>
<p>Совет для собеседования: <strong>по умолчанию возвращайте <code>Task</code></strong>; <code>ValueTask</code> — для горячих путей с измеримым эффектом, и обычно в библиотеках.</p>
<h3>SynchronizationContext и ConfigureAwait</h3>
<p>После <code>await</code> продолжение нужно где-то выполнить. По умолчанию <code>await</code> захватывает текущий <strong><code>SynchronizationContext</code></strong> (или, если его нет, текущий <code>TaskScheduler</code>) и отправляет продолжение туда:</p>
<ul><li>в WinForms и WPF контекст — UI-поток: после <code>await</code> можно трогать контролы;</li><li>в классическом ASP.NET (на .NET Framework) был <code>AspNetSynchronizationContext</code>, обеспечивающий доступ к <code>HttpContext.Current</code> и выполнение продолжений запроса по одному;</li><li><strong>в ASP.NET Core <code>SynchronizationContext</code> нет</strong>. Продолжения выполняются на любом потоке пула.</li></ul>
<p><code>ConfigureAwait(false)</code> говорит: «не возвращайся в захваченный контекст». В <strong>библиотеках</strong> его по-прежнему рекомендуют писать везде — библиотеку могут вызвать из UI-приложения или старого ASP.NET. В <strong>коде приложения на ASP.NET Core</strong> он ничего не меняет (контекста нет), и многие команды его не пишут. Важная оговорка: отсутствие контекста не делает <code>HttpContext</code> потокобезопасным — параллельно из нескольких задач к нему обращаться нельзя.</p>
<p>В .NET 8 у <code>Task</code> появилась перегрузка с флагами <code>ConfigureAwaitOptions</code>: <code>SuppressThrowing</code> (дождаться, не бросая исключение) и <code>ForceYielding</code> (всегда уступить поток, даже если задача уже завершена).</p>
<h3>Sync-over-async и deadlock</h3>
<p>Классический deadlock в приложении с контекстом:</p>
<pre><code>// WPF, обработчик кнопки на UI-потоке
private void Button_Click(object sender, RoutedEventArgs e)
{
    string data = LoadAsync().Result;   // UI-поток заблокирован в ожидании
}

private async Task&lt;string&gt; LoadAsync()
{
    await Task.Delay(100);              // продолжение хочет выполниться на UI-потоке...
    return "done";                      // ...который ждёт эту же задачу. Взаимная блокировка.
}</code></pre>
<p>В ASP.NET Core этого deadlock нет — контекста, в который нужно вернуться, нет. Но <strong>sync-over-async всё равно вредно</strong>: <code>.Result</code> или <code>.Wait()</code> блокирует поток пула на всё время ожидания I/O. Под нагрузкой все потоки оказываются заблокированы, продолжениям, которые бы их разблокировали, не на чем выполниться, пул медленно добавляет потоки — это <strong>thread pool starvation</strong> (подробнее в следующей главе). Правило — <strong>async all the way</strong>: от контроллера до драйвера базы. Если синхронный вызов неизбежен (старый API, конструктор), <code>GetAwaiter().GetResult()</code> хотя бы бросает исходное исключение, а не <code>AggregateException</code>.</p>
<h3>async void</h3>
<p><code>async void</code> допустим <strong>только для обработчиков событий</strong>. Проблемы:</p>
<ul><li>вызывающий не может дождаться завершения — нет <code>Task</code>;</li><li><strong>исключение нельзя поймать снаружи</strong>: оно выбрасывается в <code>SynchronizationContext</code>, а при его отсутствии — в thread pool как необработанное, и <strong>процесс падает</strong>;</li><li>тестовые фреймворки и хостинг не знают, что работа ещё идёт.</li></ul>
<p>Самая коварная форма — неявная: лямбда, переданная туда, где ожидается <code>Action</code>.</p>
<pre><code>orders.ForEach(async o =&gt; await SendAsync(o));  // Action&lt;Order&gt; → async void
// ForEach вернёт управление сразу, отправки идут «в фоне», исключение уронит процесс

foreach (var o in orders) await SendAsync(o);   // правильно (или Task.WhenAll / Parallel.ForEachAsync)</code></pre>
<h3>Исключения в задачах</h3>
<ul><li>Исключение в async-методе <strong>всегда</strong> попадает в возвращённую задачу — даже если оно брошено до первого <code>await</code>. Вызов <code>var t = FooAsync();</code> не бросит; бросит <code>await t</code>. (В обычном методе, который возвращает <code>Task</code> без <code>async</code>, исключение до создания задачи вылетит синхронно — это разница между <code>async</code>-методом и «пробрасывающим» методом <code>return Inner();</code>.)</li><li><code>await</code> разворачивает исключение и бросает <strong>первое</strong> из <code>AggregateException</code> с сохранённым стеком.</li><li><code>.Wait()</code> и <code>.Result</code> бросают <strong><code>AggregateException</code></strong>, <code>GetAwaiter().GetResult()</code> — исходное исключение.</li><li><strong><code>Task.WhenAll</code></strong>: если упало несколько задач, итоговая задача содержит <strong>все</strong> исключения, но <code>await</code> бросит только первое. Чтобы увидеть остальные — сохранить задачу и прочитать <code>whenAllTask.Exception.InnerExceptions</code>.</li><li>Исключение в задаче, которую никто не ждал (fire-and-forget), — <strong>unobserved</strong>: начиная с .NET 4.5 оно не роняет процесс, а поднимает событие <code>TaskScheduler.UnobservedTaskException</code> при финализации задачи. То есть ошибка просто теряется. Fire-and-forget в сервисах — через <code>BackgroundService</code> или очередь, а не голый <code>_ = DoAsync();</code>.</li></ul>
<h3>WhenAll, WhenAny, WhenEach</h3>
<pre><code>var stockTask = _stock.GetAsync(sku, ct);
var priceTask = _prices.GetAsync(sku, ct);
await Task.WhenAll(stockTask, priceTask);   // два запроса идут параллельно
var (stock, price) = (stockTask.Result, priceTask.Result); // уже завершены, .Result безопасен</code></pre>
<ul><li><code>WhenAll</code> для тысячи задач запустит тысячу запросов одновременно — нужен <strong>ограничитель</strong> (<code>SemaphoreSlim</code>, <code>Parallel.ForEachAsync</code>, пачки через <code>Chunk</code>).</li><li><code>WhenAny</code> возвращает <code>Task&lt;Task&lt;T&gt;&gt;</code> — первую <strong>завершившуюся</strong> задачу (в том числе упавшую или отменённую). Её нужно <code>await</code>-нуть, чтобы получить результат или исключение. Остальные задачи <strong>продолжают выполняться</strong> — WhenAny ничего не отменяет.</li><li>Таймаут на ожидание — <code>task.WaitAsync(TimeSpan.FromSeconds(5), ct)</code> (.NET 6): бросает <code>TimeoutException</code>, но саму операцию не отменяет; для настоящей отмены нужен токен.</li><li><code>Task.WhenEach</code> (.NET 9) — <code>IAsyncEnumerable</code> задач в порядке завершения: обработка результатов по мере готовности.</li></ul>
<h3>Отмена: CancellationToken</h3>
<p>Отмена в .NET <strong>кооперативная</strong>: никто не прерывает поток силой (<code>Thread.Abort</code> в .NET Core не поддерживается). <code>CancellationTokenSource</code> — у владельца, который решает отменить; <code>CancellationToken</code> — у исполнителя, который проверяет его и передаёт дальше.</p>
<pre><code>public async Task&lt;Report&gt; BuildAsync(CancellationToken requestAborted)
{
    using var cts = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);
    cts.CancelAfter(TimeSpan.FromSeconds(10));    // отмена по запросу клиента ИЛИ по таймауту
    var token = cts.Token;

    var rows = await _db.LoadAsync(token);        // токен — в каждый I/O-вызов
    foreach (var row in rows)
    {
        token.ThrowIfCancellationRequested();     // и в долгие CPU-циклы
        Aggregate(row);
    }
    return Build();
}</code></pre>
<ul><li>отмена проявляется как <strong><code>OperationCanceledException</code></strong> (или наследник <code>TaskCanceledException</code>), задача переходит в состояние <code>Canceled</code>; ловить её стоит отдельно и не логировать как ошибку;</li><li><strong>linked source нужно освобождать</strong> (<code>using</code>): он регистрирует колбэк в родительском токене, и без <code>Dispose</code> долгоживущий родитель накапливает эти регистрации;</li><li>то же с <code>token.Register(callback)</code> — возвращённую регистрацию нужно освобождать;</li><li>в ASP.NET Core токен отмены запроса — <code>HttpContext.RequestAborted</code> (параметр <code>CancellationToken</code> в action подставляется им); в <code>BackgroundService</code> — <code>stoppingToken</code>;</li><li><code>CancellationToken</code> — структура, её передают по значению; <code>CancellationToken.None</code> и <code>default</code> не отменяются никогда.</li></ul>
<h3>IAsyncEnumerable</h3>
<p><code>IAsyncEnumerable&lt;T&gt;</code> — асинхронная последовательность: потребитель получает элементы по мере появления и сам задаёт темп (pull, естественный backpressure).</p>
<pre><code>public async IAsyncEnumerable&lt;Shipment&gt; ReadShipmentsAsync(
    [EnumeratorCancellation] CancellationToken ct = default)
{
    await foreach (var row in _db.Shipments.AsAsyncEnumerable().WithCancellation(ct))
        yield return Map(row);
}

await foreach (var s in service.ReadShipmentsAsync().WithCancellation(ct))
    await HandleAsync(s, ct);</code></pre>
<p>Атрибут <code>[EnumeratorCancellation]</code> связывает токен параметра с токеном, переданным через <code>WithCancellation</code>. ASP.NET Core умеет отдавать <code>IAsyncEnumerable&lt;T&gt;</code> в ответ потоково, EF Core — читать из базы построчно без загрузки всего результата.</p>
<h3>TaskCompletionSource и его ловушки</h3>
<p><code>TaskCompletionSource&lt;T&gt;</code> — способ создать задачу, которую вы завершаете вручную: обёртка над callback-API, ожидание ответа на сообщение по correlation id, сигнал «готово».</p>
<pre><code>private readonly ConcurrentDictionary&lt;Guid, TaskCompletionSource&lt;Reply&gt;&gt; _pending = new();

public Task&lt;Reply&gt; RequestAsync(Request r, CancellationToken ct)
{
    var tcs = new TaskCompletionSource&lt;Reply&gt;(TaskCreationOptions.RunContinuationsAsynchronously);
    _pending[r.CorrelationId] = tcs;
    ct.Register(() =&gt; tcs.TrySetCanceled(ct));   // регистрацию в реальном коде нужно освободить
    _producer.Send(r);
    return tcs.Task;
}

// вызывается из цикла потребителя сообщений
public void OnReply(Reply reply)
{
    if (_pending.TryRemove(reply.CorrelationId, out var tcs))
        tcs.TrySetResult(reply);
}</code></pre>
<p>Главная ловушка — <strong>по умолчанию продолжения выполняются синхронно</strong> внутри <code>SetResult</code>, на потоке, который его вызвал. В примере это поток цикла потребителя: весь код после <code>await RequestAsync(...)</code> у вызывающего выполнился бы прямо в нём, задерживая чтение следующих сообщений, а если бы <code>OnReply</code> вызывался под <code>lock</code> — продолжение исполнилось бы под чужой блокировкой, с риском deadlock и реентерабельности. Флаг <strong><code>RunContinuationsAsynchronously</code></strong> заставляет отправить продолжения в пул. Ещё правила: использовать <code>TrySet*</code>, если завершить могут несколько участников (ответ, отмена, таймаут); <strong>всегда</strong> завершать TCS, иначе ожидающий повиснет навсегда.</p>
<h3>Task.Run и Task.Factory.StartNew</h3>
<ul><li><code>Task.Run</code> — способ отправить CPU-работу в пул. В ASP.NET Core «обернуть синхронный код в <code>Task.Run</code>, чтобы стало асинхронно» бессмысленно: вы просто занимаете другой поток пула вместо текущего.</li><li><code>Task.Factory.StartNew(async () =&gt; ...)</code> возвращает <code>Task&lt;Task&gt;</code> — внешняя задача завершится на первом <code>await</code> внутренней. Нужен <code>Unwrap()</code>, а проще — <code>Task.Run</code>, который разворачивает сам. Кроме того, StartNew по умолчанию использует <code>TaskScheduler.Current</code>, а не пул.</li><li><code>TaskCreationOptions.LongRunning</code> создаёт отдельный поток — имеет смысл для долгой <strong>синхронной</strong> блокирующей работы (например, цикла <code>consumer.Consume()</code> клиента Kafka), но не для async-лямбды: после первого <code>await</code> выделенный поток всё равно освободится.</li></ul>
<h3>Что спросят на собеседовании</h3>
<details><summary>«Что делает компилятор с async-методом?»</summary>
<p>Переписывает его в <strong>state machine</strong>: параметры и локальные переменные, живущие через <code>await</code>, становятся полями, тело — методом <code>MoveNext()</code> со <code>switch</code> по состоянию, а результат и исключения передаёт билдер (<code>AsyncTaskMethodBuilder</code>). Исходный метод создаёт машину, вызывает <code>Builder.Start</code> и возвращает <code>Builder.Task</code>.</p>
<p>Ключевые моменты:</p>
<ul><li>метод выполняется <strong>синхронно</strong> до первого <code>await</code> на незавершённой задаче; если всё уже готово (кеш-хит), он так и отработает синхронно;</li><li>на незавершённом <code>await</code> машина подписывается на продолжение (<code>AwaitUnsafeOnCompleted</code>) и возвращает управление — поток свободен;</li><li>в Release state machine — <strong>структура</strong>, и билдер копирует её в кучу только при первой реальной приостановке; поэтому синхронно завершившийся async-метод почти бесплатен, а приостановившийся стоит аллокации машины и <code>Task</code>;</li><li><code>await</code> работает с любым типом, у которого есть <code>GetAwaiter()</code> с <code>IsCompleted</code>, <code>OnCompleted</code> и <code>GetResult()</code> — это паттерн, а не интерфейс;</li><li>через <code>await</code> протекает <code>ExecutionContext</code>, а с ним <code>AsyncLocal&lt;T&gt;</code> — так работают <code>Activity.Current</code> и scope логгера.</li></ul>
<p>И главное «зачем»: async на сервере — это масштабируемость, а не скорость одного запроса: пока идёт I/O, поток обслуживает другие запросы.</p>
</details>
<details><summary>«Task или ValueTask?»</summary>
<p>По умолчанию — <code>Task</code>. <code>ValueTask&lt;T&gt;</code> — структура, которая содержит либо готовый результат, либо <code>Task&lt;T&gt;</code>, либо <code>IValueTaskSource&lt;T&gt;</code> — переиспользуемый объект из пула (так сделаны сокеты и Pipelines). Выигрыш есть, когда метод <strong>часто завершается синхронно</strong> — кеш-хит, данные уже в буфере: тогда не выделяется <code>Task</code>.</p>
<p>Но у <code>ValueTask</code> жёсткие правила, нарушение которых даёт неопределённое поведение, потому что источник после завершения может уже обслуживать другую операцию:</p>
<ul><li>await только один раз;</li><li>не ждать конкурентно из нескольких мест;</li><li>не читать <code>.Result</code>, пока операция не завершена;</li><li>не хранить в полях и коллекциях;</li><li>если нужно что-то из этого — сразу <code>.AsTask()</code>.</li></ul>
<p>Поэтому <code>ValueTask</code> — для горячих путей с измеримым эффектом, обычно в библиотеках. Плюс <code>Task</code> для частых результатов и так кешируется рантаймом — <code>true</code>/<code>false</code>, небольшие целые, <code>null</code>.</p>
</details>
<details><summary>«Нужен ли ConfigureAwait(false) в ASP.NET Core?»</summary>
<p>После <code>await</code> продолжение по умолчанию отправляется в захваченный <code>SynchronizationContext</code> (или текущий <code>TaskScheduler</code>). В WinForms и WPF это UI-поток, в классическом ASP.NET был <code>AspNetSynchronizationContext</code>. <strong>В ASP.NET Core контекста нет</strong>, продолжения идут на любой поток пула.</p>
<p>Поэтому в коде приложения на ASP.NET Core <code>ConfigureAwait(false)</code> ничего не меняет, и многие команды его не пишут. В <strong>библиотеках</strong> его по-прежнему стоит писать везде: библиотеку могут вызвать из WPF или старого ASP.NET, и тогда он предотвращает лишние переходы в UI-поток и deadlock при sync-over-async у вызывающего. Оговорка: отсутствие контекста не делает <code>HttpContext</code> потокобезопасным — параллельно к нему обращаться нельзя. В .NET 8 появились <code>ConfigureAwaitOptions</code>: <code>SuppressThrowing</code> и <code>ForceYielding</code>.</p>
</details>
<details><summary>«Почему .Result приводит к deadlock? А в ASP.NET Core?»</summary>
<p>В приложении с однопоточным контекстом (WPF, WinForms, классический ASP.NET) UI-поток вызывает <code>LoadAsync().Result</code> и блокируется. Внутри <code>LoadAsync</code> после <code>await</code> продолжение хочет выполниться в захваченном контексте — на том самом UI-потоке, который ждёт эту задачу. Каждый ждёт другого: взаимная блокировка.</p>
<p>В ASP.NET Core контекста нет, поэтому классического deadlock нет, но <strong>sync-over-async всё равно вредно</strong>: <code>.Result</code>/<code>.Wait()</code> держит поток пула всё время ожидания I/O. Под нагрузкой заблокированы все потоки, продолжениям, которые бы их освободили, не на чем выполниться, а пул добавляет потоки медленно — это <strong>thread pool starvation</strong>: растут latency и таймауты при низком CPU.</p>
<p>Правило — async all the way, от контроллера до драйвера. Если синхронный вызов неизбежен (старый API, конструктор), <code>GetAwaiter().GetResult()</code> хотя бы бросает исходное исключение, а не <code>AggregateException</code>.</p>
</details>
<details><summary>«Чем опасен async void?»</summary>
<p>Допустим он только для обработчиков событий. Проблемы:</p>
<ul><li>вызывающий не может дождаться завершения — <code>Task</code> нет;</li><li>исключение нельзя поймать снаружи: оно выбрасывается в <code>SynchronizationContext</code>, а без него — в пул как необработанное, и <strong>процесс падает</strong>;</li><li>тестовые фреймворки и хостинг не знают, что работа ещё идёт.</li></ul>
<p>Самая коварная форма — неявная, когда async-лямбду передают туда, где ожидается <code>Action</code>:</p>
<pre><code>orders.ForEach(async o =&gt; await SendAsync(o));  // async void
// ForEach вернётся сразу, отправки идут «в фоне», исключение уронит процесс
foreach (var o in orders) await SendAsync(o);   // правильно</code></pre>
<p>То же с <code>Parallel.ForEach</code> и async-лямбдой. Правильные варианты: обычный <code>foreach</code> с <code>await</code>, <code>Task.WhenAll</code> с ограничителем или <code>Parallel.ForEachAsync</code>.</p>
</details>
<details><summary>«Как ведут себя исключения в Task и в WhenAll?»</summary>
<p>Исключение в async-методе <strong>всегда</strong> попадает в возвращённую задачу — даже брошенное до первого <code>await</code>: <code>var t = FooAsync();</code> не бросит, бросит <code>await t</code>. <code>await</code> разворачивает <code>AggregateException</code> и бросает первое исключение с сохранённым стеком; <code>.Wait()</code> и <code>.Result</code> бросают <code>AggregateException</code>, <code>GetAwaiter().GetResult()</code> — исходное.</p>
<p>В <code>Task.WhenAll</code> итоговая задача содержит <strong>все</strong> исключения упавших задач, но <code>await</code> бросит только первое. Чтобы увидеть остальные, сохраняю задачу и читаю <code>whenAllTask.Exception.InnerExceptions</code>:</p>
<pre><code>var all = Task.WhenAll(tasks);
try { await all; }
catch { foreach (var e in all.Exception!.InnerExceptions) Log(e); }</code></pre>
<p>Задача, которую никто не ждал, — unobserved: с .NET 4.5 она не роняет процесс, а поднимает <code>TaskScheduler.UnobservedTaskException</code> при финализации, то есть ошибка просто теряется. Поэтому fire-and-forget в сервисах — через <code>BackgroundService</code> или очередь, а не <code>_ = DoAsync();</code>.</p>
</details>
<details><summary>«Как устроена отмена?»</summary>
<p>Отмена <strong>кооперативная</strong>: никто не прерывает поток силой, <code>Thread.Abort</code> в .NET Core не поддерживается. <code>CancellationTokenSource</code> у того, кто решает отменить, <code>CancellationToken</code> — у исполнителя, который передаёт его в каждый I/O-вызов и проверяет в долгих CPU-циклах через <code>ThrowIfCancellationRequested()</code>.</p>
<ul><li>отмена проявляется как <code>OperationCanceledException</code> (или <code>TaskCanceledException</code>), задача переходит в <code>Canceled</code>; ловлю её отдельно и не логирую как ошибку;</li><li>«отмена клиентом или таймаут» — linked source: <code>CreateLinkedTokenSource(requestAborted)</code> плюс <code>CancelAfter</code>;</li><li>linked source и регистрации <code>token.Register</code> нужно освобождать: они вешают колбэк на родительский токен, и без <code>Dispose</code> долгоживущий родитель их копит — утечка;</li><li>в ASP.NET Core токен запроса — <code>HttpContext.RequestAborted</code>, его подставляет параметр <code>CancellationToken</code> в action; в <code>BackgroundService</code> — <code>stoppingToken</code>;</li><li><code>CancellationToken.None</code> и <code>default</code> не отменяются никогда.</li></ul>
<p>И нюанс про таймауты: <code>task.WaitAsync(timeout)</code> перестаёт ждать, но саму операцию не отменяет — для настоящей отмены нужен токен.</p>
</details>
<details><summary>«Зачем TaskCompletionSource и RunContinuationsAsynchronously?»</summary>
<p><code>TaskCompletionSource&lt;T&gt;</code> создаёт задачу, которую завершают вручную: обёртка над callback-API, ожидание ответа по correlation id, сигнал «готово».</p>
<p>Ловушка в том, что <strong>по умолчанию продолжения выполняются синхронно внутри <code>SetResult</code></strong>, на потоке, который его вызвал. Если <code>SetResult</code> вызывает цикл потребителя сообщений, весь код после <code>await</code> у ожидающего выполнится прямо в этом цикле и задержит чтение следующих сообщений. Если <code>SetResult</code> вызван под <code>lock</code>, чужое продолжение исполнится под вашей блокировкой — риск deadlock и реентерабельности. Флаг <code>TaskCreationOptions.RunContinuationsAsynchronously</code> отправляет продолжения в пул.</p>
<p>Ещё два правила: использовать <code>TrySet*</code>, когда завершить могут несколько участников (ответ, отмена, таймаут), и <strong>всегда</strong> завершать TCS — иначе ожидающий повиснет навсегда, а регистрации отмены освобождать.</p>
</details>
<details><summary>«Чем Task.Run отличается от Task.Factory.StartNew?»</summary>
<p><code>Task.Run</code> — простой способ отправить работу в пул с разумными настройками: <code>TaskScheduler.Default</code> и автоматическое разворачивание async-лямбды. <code>Task.Factory.StartNew</code> — низкоуровневый API с ловушками:</p>
<ul><li><code>StartNew(async () =&gt; ...)</code> возвращает <code>Task&lt;Task&gt;</code>: внешняя задача завершается на первом <code>await</code> внутренней, и <code>await</code> её «дождётся» раньше, чем работа закончится; нужен <code>Unwrap()</code>;</li><li>по умолчанию используется <code>TaskScheduler.Current</code>, а не пул — внутри задачи с нестандартным планировщиком это неожиданно.</li></ul>
<p><code>StartNew</code> оправдан с <code>TaskCreationOptions.LongRunning</code>, который создаёт отдельный поток для долгой <strong>синхронной</strong> блокирующей работы, например цикла <code>consumer.Consume()</code> клиента Kafka. Для async-лямбды это бессмысленно: после первого <code>await</code> выделенный поток всё равно освободится. И в ASP.NET Core оборачивать синхронный код в <code>Task.Run</code>, «чтобы стало асинхронно», бессмысленно — вы просто занимаете другой поток пула.</p>
</details>
<details><summary>«Что такое IAsyncEnumerable и когда он нужен?»</summary>
<p>Это асинхронная последовательность: потребитель через <code>await foreach</code> получает элементы по мере появления и сам задаёт темп — модель pull, а значит естественный backpressure. Производитель пишется как <code>async IAsyncEnumerable&lt;T&gt;</code> с <code>yield return</code>.</p>
<p>Типичное применение — потоковое чтение большого результата: EF Core через <code>AsAsyncEnumerable()</code> читает строки из базы по одной, не загружая всё в память, а ASP.NET Core умеет отдавать <code>IAsyncEnumerable&lt;T&gt;</code> в ответ потоково. Токен отмены передают через <code>WithCancellation(ct)</code>, а в производителе параметр помечают <code>[EnumeratorCancellation]</code>, чтобы связать его с этим токеном. В .NET 10 LINQ для <code>IAsyncEnumerable&lt;T&gt;</code> вошёл в стандартную библиотеку.</p>
</details>` },
    { id: `threading`, title: `Потоки и синхронизация`, html: `<h3>Thread pool</h3>
<p>Создавать поток ОС на каждую задачу дорого (стек, системные вызовы, переключения), поэтому почти вся работа в .NET выполняется на потоках <strong>thread pool</strong>: продолжения <code>await</code>, <code>Task.Run</code>, обработка запросов Kestrel, колбэки таймеров.</p>
<p>Устройство в общих чертах:</p>
<ul><li><strong>Очереди.</strong> Есть глобальная очередь и <strong>локальная очередь у каждого потока пула</strong>. Задача, поставленная с потока пула, попадает в его локальную очередь (и берётся оттуда в порядке LIFO — свежие данные ещё в кеше процессора), остальные — в глобальную (FIFO). Простаивающий поток <strong>крадёт</strong> работу из чужих локальных очередей (work stealing).</li><li><strong>Worker и I/O-потоки.</strong> Исторически пул делится на worker-потоки и I/O completion-потоки. На Windows завершения I/O приходят через IOCP; на Linux сокеты обслуживаются отдельными потоками-«движками» на epoll, которые передают продолжения на worker-потоки. Для прикладного кода важнее, что async I/O <strong>не держит поток</strong> во время ожидания вовсе.</li><li><strong>Сколько потоков.</strong> Минимум (<code>ThreadPool.GetMinThreads</code>) по умолчанию равен числу логических процессоров. До минимума потоки создаются сразу по требованию. Выше минимума пул добавляет потоки <strong>осторожно</strong>: алгоритм <strong>hill climbing</strong> экспериментально ищет число потоков с максимальной пропускной способностью, а механизм обнаружения голодания добавляет поток, если очередь не продвигается, — порядка одного-двух потоков в секунду.</li></ul>
<h3>Thread pool starvation</h3>
<p>Голодание пула — один из самых частых инцидентов в продакшене .NET-сервисов. Сценарий:</p>
<ol><li>Код блокирует потоки пула синхронным ожиданием: <code>.Result</code>, <code>.Wait()</code>, <code>Thread.Sleep</code>, синхронный HTTP или драйвер базы, <code>lock</code> с долгим ожиданием.</li><li>Под всплеском нагрузки все потоки пула заблокированы. Продолжения, которые должны их разбудить (ответ от базы пришёл!), стоят в очереди — им не на чем выполниться.</li><li>Пул добавляет потоки по одному-два в секунду; новые потоки тут же забирают новые запросы и тоже блокируются.</li></ol>
<p>Как это выглядит снаружи: <strong>растёт latency и таймауты при низкой загрузке CPU</strong>, health-check-и начинают падать, число потоков процесса медленно ползёт вверх, а очередь пула растёт. Диагностика:</p>
<ul><li><code>dotnet-counters monitor</code> по <code>System.Runtime</code>: длина очереди пула (<code>threadpool-queue-length</code>) растёт, число потоков пула растёт ступеньками, число завершённых элементов в секунду падает;</li><li><code>dotnet-stack</code> или дамп (<code>dotnet-dump</code>, <code>clrstack</code> по всем потокам): сотни потоков стоят в <code>Task.Wait</code>, <code>Monitor.Enter</code>, <code>ManualResetEventSlim.Wait</code>.</li></ul>
<p>Лечение — <strong>убрать блокирующие вызовы</strong> (async all the way). <code>ThreadPool.SetMinThreads</code> с большим минимумом — временный пластырь, который снимает симптом, но не причину. Отдельный случай — долгие блокирующие циклы (потребитель Kafka на синхронном <code>Consume</code>): им нужен <strong>выделенный поток</strong> (<code>new Thread</code> или <code>TaskCreationOptions.LongRunning</code>), а не поток из пула.</p>
<h3>lock и Monitor</h3>
<p><code>lock (obj) { ... }</code> компилируется в <code>Monitor.Enter(obj, ref lockTaken)</code> и <code>Monitor.Exit(obj)</code> в <code>finally</code>. Монитор:</p>
<ul><li>сначала пробует захватить «тонкую» блокировку прямо в заголовке объекта, при конкуренции <strong>крутится</strong> (spin) короткое время и только потом засыпает на объекте ядра — так короткие критические секции дёшевы;</li><li><strong>реентерабелен</strong>: поток, уже держащий lock, может войти повторно;</li><li><strong>привязан к потоку</strong>: отпустить может только захвативший поток.</li></ul>
<p>Поэтому <strong>внутри <code>lock</code> нельзя <code>await</code></strong> — это ошибка компиляции CS1996. После <code>await</code> продолжение может выполниться на другом потоке, и <code>Monitor.Exit</code> вызвал бы не владелец; да и держать блокировку через I/O — плохая идея. Для асинхронного кода — <code>SemaphoreSlim</code>.</p>
<p>Правила хорошего тона: блокировать <strong>приватный <code>readonly</code>-объект</strong>, а не <code>this</code>, <code>typeof(X)</code> или строку (интернированная строка — общий для всего процесса объект); держать lock как можно короче; не вызывать под ним чужой код (события, колбэки, виртуальные методы) — так рождаются deadlock-и. <code>Monitor.Wait</code>/<code>Pulse</code> дают условные переменные, но в прикладном коде их почти всегда заменяют каналы или <code>SemaphoreSlim</code>.</p>
<h3>System.Threading.Lock (.NET 9)</h3>
<p>В .NET 9 появился отдельный тип <strong><code>System.Threading.Lock</code></strong>, а C# 13 научил оператор <code>lock</code> его распознавать:</p>
<pre><code>private readonly Lock _gate = new();

public void Add(Item item)
{
    lock (_gate)          // компилируется в using (_gate.EnterScope()) { ... }
    {
        _items.Add(item);
    }
}</code></pre>
<p>Преимущества: намерение явно (это объект-блокировка, а не произвольный объект), реализация быстрее и не использует заголовок объекта и sync block. Методы: <code>Enter</code>, <code>TryEnter</code>, <code>Exit</code>, <code>EnterScope</code>. Ловушка: если привести <code>Lock</code> к <code>object</code> и сделать <code>lock</code> по нему, выполнится старый <code>Monitor</code>, — компилятор предупреждает. Ограничения те же, что у <code>Monitor</code>: привязка к потоку, нельзя через <code>await</code>.</p>
<h3>SemaphoreSlim</h3>
<p>Счётный семафор: пропускает не больше N владельцев одновременно. Главное отличие от <code>lock</code> — есть <strong><code>WaitAsync</code></strong>, то есть ожидание без блокировки потока.</p>
<pre><code>private readonly SemaphoreSlim _mutex = new(1, 1);

public async Task RefreshAsync(CancellationToken ct)
{
    await _mutex.WaitAsync(ct);
    try
    {
        await ReloadCacheAsync(ct);   // await внутри — допустимо
    }
    finally
    {
        _mutex.Release();
    }
}</code></pre>
<p>Особенности: <strong>не реентерабелен</strong> (повторный <code>WaitAsync</code> тем же кодом — deadlock); не знает владельца, <code>Release</code> может вызвать кто угодно; лишний <code>Release</code> сверх <code>maxCount</code> бросает <code>SemaphoreFullException</code>; <code>Release</code> — всегда в <code>finally</code>. Второе применение — <strong>ограничение параллелизма</strong>: <code>new SemaphoreSlim(10)</code> вокруг вызова внешнего API, чтобы не отправлять в него тысячу запросов одновременно.</p>
<h3>Interlocked</h3>
<p>Атомарные операции над одной переменной без блокировок: <code>Increment</code>, <code>Decrement</code>, <code>Add</code>, <code>Exchange</code>, <code>CompareExchange</code>, <code>Read</code> (для 64-битных значений на 32-битной платформе). Каждая операция — полный барьер памяти. Для всего, что сложнее одной операции, применяют <strong>CAS-цикл</strong>:</p>
<pre><code>private int _max;

public void Observe(int value)
{
    int current, updated;
    do
    {
        current = Volatile.Read(ref _max);
        updated = Math.Max(current, value);
        if (updated == current) return;
    }
    while (Interlocked.CompareExchange(ref _max, updated, current) != current);
    // CompareExchange записывает updated, только если в поле всё ещё current;
    // иначе другой поток успел изменить значение — пробуем снова
}</code></pre>
<p>Счётчики метрик, флаги «выполнено один раз», атомарная замена ссылки на неизменяемый снимок (<code>Interlocked.Exchange(ref _config, newConfig)</code>) — типичные применения.</p>
<h3>ReaderWriterLockSlim</h3>
<p>Разрешает <strong>много читателей одновременно или одного писателя</strong>, плюс режим upgradeable read (читатель, который может стать писателем). Имеет смысл, когда чтений намного больше, чем записей, а критическая секция чтения не микроскопическая. Ограничения: привязка к потоку, нет асинхронной версии, накладные расходы выше, чем у <code>lock</code> — на коротких секциях обычный <code>lock</code> часто быстрее. Альтернатива для «читают постоянно, меняют редко»: держать <strong>неизменяемый снимок</strong> (например, <code>FrozenDictionary</code>) и атомарно подменять ссылку при обновлении — читатели не синхронизируются вообще.</p>
<h3>volatile и модель памяти .NET</h3>
<p>Компилятор, JIT и процессор вправе <strong>переупорядочивать</strong> чтения и записи и <strong>кешировать</strong> значения в регистрах, если это не меняет поведения <strong>однопоточной</strong> программы. Для многопоточной программы это меняет всё. Классический баг:</p>
<pre><code>private bool _stop;   // без volatile

void Worker()
{
    while (!_stop) { /* работа без вызовов */ }   // в Release JIT может прочитать _stop один раз
}                                                  // и крутиться вечно</code></pre>
<p><code>volatile</code> (или <code>Volatile.Read</code>/<code>Volatile.Write</code>) даёт семантику <strong>acquire при чтении и release при записи</strong>: чтение не будет вынесено из цикла, последующие операции не переедут раньше volatile-чтения, предыдущие — позже volatile-записи. Чего <code>volatile</code> <strong>не</strong> делает:</p>
<ul><li>не делает составные операции атомарными: <code>_count++</code> на volatile-поле — это чтение, сложение и запись, и инкременты из разных потоков теряются. Нужен <code>Interlocked.Increment</code>;</li><li>не запрещает переупорядочивание «запись, затем чтение другой переменной» — для этого нужен полный барьер (<code>Interlocked</code>, <code>lock</code>, <code>Thread.MemoryBarrier</code>).</li></ul>
<p>Что ещё полезно знать: запись и чтение ссылок и выровненных примитивов до размера указателя атомарны, а запись структуры — нет (другой поток может увидеть «половину» значения, tearing). x86/x64 — платформы с сильной моделью памяти, и многие гонки на них не проявляются, но проявляются на <strong>ARM64</strong> (серверы Graviton, Apple Silicon). У .NET есть документированная модель памяти в репозитории рантайма. Практический вывод для собеседования: <strong>не изобретать lock-free</strong>, а пользоваться <code>lock</code>, <code>Interlocked</code>, <code>Lazy&lt;T&gt;</code>, concurrent-коллекциями и каналами.</p>
<p>Ленивая потокобезопасная инициализация — <code>Lazy&lt;T&gt;</code> (по умолчанию <code>ExecutionAndPublication</code>: фабрика выполнится один раз) или <code>static readonly</code>-поле, которое рантайм инициализирует потокобезопасно. Ручной double-checked locking без <code>volatile</code> — классическая ошибка.</p>
<h3>Deadlock</h3>
<p>Взаимная блокировка возможна, когда выполняются <strong>все четыре условия Коффмана</strong>: взаимное исключение (ресурс у одного владельца), удержание и ожидание (держим один ресурс и ждём другой), отсутствие вытеснения (ресурс нельзя отнять), <strong>циклическое ожидание</strong>. Чтобы deadlock-а не было, достаточно сломать одно — на практике циклическое ожидание:</p>
<ul><li><strong>единый порядок захвата</strong>: если коду нужны блокировки A и B, все берут сначала A, потом B (то же правило работает для строк в базе — обновлять в одном порядке, например по возрастанию id);</li><li>короткие критические секции и никакого чужого кода под блокировкой;</li><li>таймауты (<code>Monitor.TryEnter(obj, timeout)</code>, <code>WaitAsync(timeout)</code>) — чтобы хотя бы обнаружить проблему;</li><li>в async-коде — не смешивать синхронное ожидание с асинхронным.</li></ul>
<h3>Channels: producer/consumer</h3>
<p><code>System.Threading.Channels</code> — асинхронная очередь производитель/потребитель. Это основной современный инструмент для фоновой обработки внутри процесса: принять сообщения, буферизовать, обработать пачками.</p>
<pre><code>var channel = Channel.CreateBounded&lt;StockEvent&gt;(new BoundedChannelOptions(1_000)
{
    FullMode = BoundedChannelFullMode.Wait,   // производитель ждёт, если очередь полна
    SingleReader = true                       // подсказка для более быстрой реализации
});

// производитель (например, обработчик сообщений из Kafka)
await channel.Writer.WriteAsync(evt, ct);

// потребитель (BackgroundService)
await foreach (var e in channel.Reader.ReadAllAsync(ct))
    await _repository.ApplyAsync(e, ct);

// при остановке
channel.Writer.Complete();   // ReadAllAsync завершится, дочитав остаток</code></pre>
<ul><li><strong>Bounded</strong> канал даёт <strong>backpressure</strong>: быстрый производитель замедляется до скорости потребителя, а память не растёт. Режимы переполнения: <code>Wait</code>, <code>DropOldest</code>, <code>DropNewest</code>, <code>DropWrite</code>.</li><li><strong>Unbounded</strong> канал проще, но при медленном потребителе это неограниченный рост памяти.</li><li>В отличие от <code>BlockingCollection</code>, ожидание асинхронное — потоки пула не блокируются.</li></ul>
<h3>Parallel.ForEachAsync и друзья</h3>
<pre><code>await Parallel.ForEachAsync(skus,
    new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },
    async (sku, token) =&gt; await _catalog.SyncAsync(sku, token));</code></pre>
<p><code>Parallel.ForEachAsync</code> (.NET 6) — правильный способ выполнить асинхронную операцию для множества элементов с ограничением параллелизма. По умолчанию степень параллелизма равна числу процессоров. <code>Parallel.For</code>/<code>Parallel.ForEach</code> и PLINQ (<code>AsParallel()</code>) — для <strong>CPU-bound</strong> синхронной работы. Частая ошибка — передать async-лямбду в <code>Parallel.ForEach</code>: она становится <code>async void</code>, цикл завершается, не дождавшись работы, а исключения роняют процесс.</p>
<h3>Что когда использовать</h3>
<table><thead><tr><th>Задача</th><th>Инструмент</th></tr></thead><tbody><tr><td>Защитить короткую синхронную критическую секцию</td><td><code>lock</code> (на <code>Lock</code> в .NET 9+)</td></tr><tr><td>Взаимное исключение с <code>await</code> внутри</td><td><code>SemaphoreSlim(1, 1)</code> + <code>WaitAsync</code></td></tr><tr><td>Ограничить число одновременных вызовов</td><td><code>SemaphoreSlim(N)</code>, <code>Parallel.ForEachAsync</code>, bounded channel</td></tr><tr><td>Счётчик, флаг, замена ссылки</td><td><code>Interlocked</code></td></tr><tr><td>Много чтений, редкие записи</td><td>неизменяемый снимок + атомарная замена; иначе <code>ReaderWriterLockSlim</code></td></tr><tr><td>Ленивая инициализация</td><td><code>Lazy&lt;T&gt;</code>, <code>static readonly</code></td></tr><tr><td>Очередь между частями приложения</td><td><code>Channel&lt;T&gt;</code> (bounded)</td></tr><tr><td>Кеш, общий для потоков</td><td><code>ConcurrentDictionary</code>, <code>MemoryCache</code>, <code>HybridCache</code></td></tr><tr><td>CPU-bound обработка массива данных</td><td><code>Parallel.For</code>, PLINQ</td></tr><tr><td>Долгий блокирующий цикл</td><td>выделенный поток</td></tr></tbody></table>
<h3>Что спросят на собеседовании</h3>
<details><summary>«Как устроен thread pool и как он добавляет потоки?»</summary>
<p>Почти вся работа в .NET идёт на потоках пула: продолжения <code>await</code>, <code>Task.Run</code>, запросы Kestrel, колбэки таймеров — создавать поток ОС на задачу дорого.</p>
<ul><li><strong>Очереди</strong>: глобальная (FIFO) и локальная у каждого потока пула. Работа, поставленная с потока пула, идёт в его локальную очередь и берётся оттуда LIFO — свежие данные ещё в кеше процессора. Простаивающий поток <strong>крадёт</strong> работу из чужих локальных очередей (work stealing).</li><li><strong>Число потоков</strong>: минимум по умолчанию равен числу логических процессоров, до него потоки создаются сразу. Выше минимума пул осторожен: <strong>hill climbing</strong> экспериментально ищет число потоков с максимальной пропускной способностью, а механизм обнаружения голодания добавляет поток, если очередь не продвигается, — порядка одного-двух в секунду.</li><li><strong>I/O</strong>: завершения приходят через IOCP на Windows и через epoll-потоки на Linux, а главное для прикладного кода — async I/O во время ожидания не держит поток вовсе.</li></ul>
<p>Медленный рост сверх минимума — сознательное решение (лишние потоки дают переключения контекста), и именно он делает starvation таким болезненным.</p>
</details>
<details><summary>«Что такое thread pool starvation, как его обнаружить и вылечить?»</summary>
<p>Сценарий: код блокирует потоки пула синхронным ожиданием — <code>.Result</code>, <code>.Wait()</code>, <code>Thread.Sleep</code>, синхронный HTTP или драйвер базы, долгий <code>lock</code>. При всплеске нагрузки заблокированы все потоки, а продолжения, которые бы их разбудили («ответ от базы пришёл»), стоят в очереди — им не на чем выполниться. Пул добавляет по одному-два потока в секунду, и новые тут же забирают новые запросы и тоже блокируются.</p>
<p>Симптомы: <strong>растут latency и таймауты при низкой загрузке CPU</strong>, падают health-check-и, число потоков процесса медленно ползёт вверх. Диагностика: <code>dotnet-counters monitor</code> по <code>System.Runtime</code> — растёт <code>threadpool-queue-length</code>, число потоков растёт ступеньками, завершённых элементов в секунду меньше; <code>dotnet-stack</code> или дамп (<code>dotnet-dump</code>, <code>clrstack</code>) показывает сотни потоков в <code>Task.Wait</code>, <code>Monitor.Enter</code>, <code>ManualResetEventSlim.Wait</code>.</p>
<p>Лечение — убрать блокирующие вызовы, async all the way. <code>ThreadPool.SetMinThreads</code> — временный пластырь, снимающий симптом. Долгим блокирующим циклам вроде синхронного <code>Consume</code> Kafka нужен выделенный поток, а не поток из пула.</p>
</details>
<details><summary>«Почему нельзя await внутри lock? Чем заменить?»</summary>
<p><code>lock</code> компилируется в <code>Monitor.Enter</code>/<code>Monitor.Exit</code> в <code>finally</code>, а монитор <strong>привязан к потоку</strong>: отпустить его может только захвативший поток. После <code>await</code> продолжение может выполниться на другом потоке, и <code>Exit</code> вызвал бы не владелец. Поэтому компилятор запрещает это ошибкой CS1996. Да и по смыслу держать блокировку через I/O — значит заставить всех ждать сетевой вызов.</p>
<p>Замена — <code>SemaphoreSlim(1, 1)</code>, у которого есть асинхронное ожидание:</p>
<pre><code>await _mutex.WaitAsync(ct);
try { await ReloadCacheAsync(ct); }
finally { _mutex.Release(); }</code></pre>
<p>Особенности: он <strong>не реентерабелен</strong> (повторный вход тем же кодом — deadlock), не знает владельца, лишний <code>Release</code> бросает <code>SemaphoreFullException</code>, а <code>Release</code> всегда в <code>finally</code>. Второе применение — <code>new SemaphoreSlim(10)</code> как ограничитель параллелизма вокруг внешнего API. Сам монитор, кстати, реентерабелен и при конкуренции сначала крутится (spin), а потом засыпает — поэтому короткие секции под <code>lock</code> дешёвы.</p>
</details>
<details><summary>«Что такое новый Lock в .NET 9?»</summary>
<p><code>System.Threading.Lock</code> — отдельный тип-блокировка, который C# 13 распознаёт в операторе <code>lock</code>: <code>lock (_gate)</code> компилируется в <code>using (_gate.EnterScope())</code>. Плюсы: намерение явно — это объект для блокировки, а не произвольный объект, и реализация быстрее, потому что не использует заголовок объекта и sync block. Есть методы <code>Enter</code>, <code>TryEnter</code>, <code>Exit</code>, <code>EnterScope</code>.</p>
<pre><code>private readonly Lock _gate = new();
lock (_gate) { _items.Add(item); }</code></pre>
<p>Ловушка: если привести <code>Lock</code> к <code>object</code> и сделать <code>lock</code> по нему, выполнится старый <code>Monitor</code> — компилятор об этом предупреждает. Семантика та же, что у монитора: привязка к потоку и запрет <code>await</code> внутри. В новом коде на .NET 9+ я бы использовал его для всех коротких синхронных секций — по-прежнему с приватным readonly-полем, не <code>this</code> и не строкой.</p>
</details>
<details><summary>«Что гарантирует volatile? Атомарен ли ++ на volatile-поле?»</summary>
<p>JIT и процессор могут переупорядочивать и кешировать чтения и записи, если это не меняет поведения однопоточной программы. Классический баг — цикл <code>while (!_stop)</code>, где JIT в Release читает поле один раз и крутится вечно. <code>volatile</code> (или <code>Volatile.Read</code>/<code>Volatile.Write</code>) даёт семантику <strong>acquire при чтении и release при записи</strong>: чтение не выносится из цикла, последующие операции не переезжают раньше volatile-чтения, предыдущие — позже volatile-записи.</p>
<p>Чего он не делает:</p>
<ul><li><code>_count++</code> на volatile-поле <strong>не атомарен</strong> — это чтение, сложение и запись, и инкременты из разных потоков теряются; нужен <code>Interlocked.Increment</code>;</li><li>не запрещает переупорядочивание «запись, затем чтение другой переменной» — для этого нужен полный барьер (<code>Interlocked</code>, <code>lock</code>, <code>Thread.MemoryBarrier</code>).</li></ul>
<p>Дополнительно: чтение и запись ссылок и выровненных примитивов до размера указателя атомарны, а структуры — нет (tearing). x86/x64 прощают многие гонки, ARM64 (Graviton, Apple Silicon) — нет. Практический вывод: не изобретать lock-free, а брать <code>lock</code>, <code>Interlocked</code>, <code>Lazy&lt;T&gt;</code>, concurrent-коллекции; ручной double-checked locking без <code>volatile</code> — классическая ошибка.</p>
</details>
<details><summary>«Какие условия нужны для deadlock и как его избегать?»</summary>
<p>Четыре условия Коффмана, и все должны выполняться одновременно: <strong>взаимное исключение</strong> (у ресурса один владелец), <strong>удержание и ожидание</strong> (держим один ресурс и ждём другой), <strong>отсутствие вытеснения</strong> (ресурс нельзя отнять), <strong>циклическое ожидание</strong>. Достаточно сломать одно, и на практике ломают циклическое ожидание:</p>
<ul><li><strong>единый порядок захвата</strong>: все берут сначала A, потом B; то же правило для строк в базе — обновлять в одном порядке, например по возрастанию id;</li><li>короткие критические секции и никакого чужого кода под блокировкой — событий, колбэков, виртуальных методов;</li><li>таймауты (<code>Monitor.TryEnter(obj, timeout)</code>, <code>WaitAsync(timeout)</code>), чтобы хотя бы обнаружить проблему;</li><li>в async-коде не смешивать синхронное ожидание с асинхронным — это источник deadlock с контекстом синхронизации.</li></ul>
<p>Диагностирую дампом: видно, какой поток какую блокировку держит и чего ждёт.</p>
</details>
<details><summary>«Как сделать producer/consumer внутри процесса?»</summary>
<p>Через <code>System.Threading.Channels</code> — асинхронную очередь, где и запись, и чтение не блокируют потоки:</p>
<pre><code>var channel = Channel.CreateBounded&lt;StockEvent&gt;(new BoundedChannelOptions(1_000)
{
    FullMode = BoundedChannelFullMode.Wait,
    SingleReader = true
});
await channel.Writer.WriteAsync(evt, ct);                    // производитель
await foreach (var e in channel.Reader.ReadAllAsync(ct))     // потребитель в BackgroundService
    await _repository.ApplyAsync(e, ct);
channel.Writer.Complete();                                   // при остановке</code></pre>
<p>Ключевое — <strong>bounded</strong> канал: он даёт backpressure, быстрый производитель замедляется до скорости потребителя, и память не растёт. Режим переполнения выбирают по смыслу: <code>Wait</code>, <code>DropOldest</code>, <code>DropNewest</code>, <code>DropWrite</code>. Unbounded проще, но при медленном потребителе это неограниченный рост памяти. <code>SingleReader</code>/<code>SingleWriter</code> — подсказки для более быстрой реализации. <code>BlockingCollection</code> решала ту же задачу, но блокировала потоки, поэтому в новом коде её вытеснили каналы.</p>
</details>
<details><summary>«Parallel.ForEach с async-лямбдой — что не так?»</summary>
<p><code>Parallel.ForEach</code> принимает <code>Action&lt;T&gt;</code>, поэтому async-лямбда становится <strong><code>async void</code></strong>. Каждая итерация завершается на первом <code>await</code>, цикл возвращает управление, не дождавшись реальной работы, исключения не попадают к вызывающему и роняют процесс, а ограничение параллелизма фактически не работает — запускается всё сразу.</p>
<p>Правильно — <code>Parallel.ForEachAsync</code> (.NET 6), который ждёт каждую итерацию и ограничивает степень параллелизма:</p>
<pre><code>await Parallel.ForEachAsync(skus,
    new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },
    async (sku, token) =&gt; await _catalog.SyncAsync(sku, token));</code></pre>
<p>По умолчанию степень параллелизма равна числу процессоров — для I/O её обычно задают явно. <code>Parallel.For</code>/<code>ForEach</code> и PLINQ оставляю для CPU-bound синхронной работы.</p>
</details>
<details><summary>«Как работает Interlocked.CompareExchange и что такое CAS-цикл?»</summary>
<p><code>Interlocked</code> — атомарные операции над одной переменной без блокировок: <code>Increment</code>, <code>Add</code>, <code>Exchange</code>, <code>CompareExchange</code>; каждая — полный барьер памяти. <code>CompareExchange(ref field, value, comparand)</code> записывает <code>value</code>, только если в поле всё ещё <code>comparand</code>, и возвращает то, что там было. На этом строится <strong>CAS-цикл</strong> для любой операции сложнее одной: прочитать текущее значение, вычислить новое, попытаться записать; если другой поток успел изменить поле — повторить.</p>
<pre><code>do
{
    current = Volatile.Read(ref _max);
    updated = Math.Max(current, value);
    if (updated == current) return;
}
while (Interlocked.CompareExchange(ref _max, updated, current) != current);</code></pre>
<p>Типичные применения: счётчики метрик, флаг «выполнено один раз», атомарная подмена ссылки на неизменяемый снимок конфигурации или справочника (<code>Interlocked.Exchange(ref _config, newConfig)</code>) — тогда читатели вообще не синхронизируются. Это и альтернатива <code>ReaderWriterLockSlim</code> для сценария «читают постоянно, меняют редко».</p>
</details>` },
    { id: `runtime`, title: `Исключения, JIT и рантайм`, html: `<h3>Сколько стоит исключение</h3>
<p>Исключение в .NET — дорогая операция, и дело не в <code>try</code>: блок <code>try</code> без броска почти ничего не стоит. Дорого именно <strong>бросание</strong>:</p>
<ul><li>создаётся объект исключения, захватывается <strong>трассировка стека</strong> (обход кадров);</li><li>обработка идёт <strong>в два прохода</strong>: на первом рантайм ищет подходящий <code>catch</code>, проходя кадры вверх и вычисляя фильтры <code>when</code>; на втором — <strong>раскручивает стек</strong> (unwinding), выполняя <code>finally</code> и блоки <code>using</code> всех пройденных кадров, и передаёт управление в найденный <code>catch</code>.</li></ul>
<p>Это микросекунды на исключение — незаметно для ошибки, которая случается раз в минуту, и катастрофично для «исключения как способа управления потоком» на тысячах запросов в секунду. В .NET 9 механизм обработки исключений переписан на управляемый код (по образцу NativeAOT) и стал в несколько раз быстрее, но правило не изменилось: <strong>исключения — для исключительных ситуаций</strong>. Для ожидаемых неудач — <code>TryParse</code>, <code>TryGetValue</code>, коды возврата, Result-паттерн (<code>Result&lt;T&gt;</code> с ошибкой вместо броска), валидация до операции.</p>
<h3>Фильтры исключений</h3>
<pre><code>try
{
    await _client.SendAsync(request, ct);
}
catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
{
    return null;    // обрабатываем только 404, остальные коды летят дальше
}</code></pre>
<p>Фильтр <code>when</code> вычисляется <strong>на первом проходе, до раскрутки стека</strong>. Отсюда его преимущества перед <code>catch { if (...) throw; }</code>:</p>
<ul><li>если фильтр вернул <code>false</code>, исключение продолжает подниматься так, будто этого <code>catch</code> нет, — <strong>стек и место броска не трогаются</strong>, дамп при падении покажет исходную точку;</li><li><code>finally</code> вложенных вызовов к моменту вычисления фильтра <strong>ещё не выполнены</strong> — это легко проверить вопросом на собеседовании (см. вопросы);</li><li>можно логировать, не перехватывая: <code>catch (Exception ex) when (Log(ex))</code>, где <code>Log</code> возвращает <code>false</code>;</li><li>исключение, брошенное внутри фильтра, проглатывается, и фильтр считается вернувшим <code>false</code>.</li></ul>
<h3>throw, throw ex и ExceptionDispatchInfo</h3>
<pre><code>try { Process(); }
catch (Exception ex)
{
    _logger.LogError(ex, "Ошибка обработки");
    throw;        // пробрасывает то же исключение с исходной трассировкой
    // throw ex;  // сбрасывает трассировку: стек начнётся с этой строки
}</code></pre>
<ul><li><code>throw;</code> — правильный проброс.</li><li><code>throw ex;</code> — трассировка перезаписывается, исходное место ошибки теряется. Анализаторы предупреждают об этом.</li><li><code>throw new DomainException("...", ex);</code> — обёртка с <code>InnerException</code>, когда нужно добавить смысл.</li><li><strong><code>ExceptionDispatchInfo.Capture(ex).Throw()</code></strong> — бросить захваченное исключение <strong>позже или в другом месте</strong> (в другом потоке, после завершения цикла), сохранив исходную трассировку и дописав к ней новую точку. Именно так <code>await</code> пробрасывает исключение из задачи.</li></ul>
<p>Ещё несколько фактов, которые любят спрашивать:</p>
<ul><li>исключение, брошенное в <code>finally</code> (или в <code>Dispose</code> внутри <code>using</code>), <strong>заменяет</strong> исходное — первоначальная ошибка теряется;</li><li><code>StackOverflowException</code> перехватить нельзя — процесс завершается; поэтому рекурсия с неограниченной глубиной и большие <code>stackalloc</code> опасны;</li><li>глобальные точки: <code>AppDomain.CurrentDomain.UnhandledException</code> (только сообщает, процесс всё равно упадёт), <code>TaskScheduler.UnobservedTaskException</code>, в ASP.NET Core — middleware обработки исключений и <code>IExceptionHandler</code> (.NET 8), отдающие <code>ProblemDetails</code>.</li></ul>
<h3>Как проектировать обработку ошибок</h3>
<p>То, что отличает senior-ответ от перечисления синтаксиса, — понимание, <strong>где</strong> ловить исключения:</p>
<ul><li><strong>Ловить там, где можно что-то сделать</strong>: повторить запрос, перевести в другой код ответа, вернуть значение по умолчанию. <code>catch (Exception) { }</code> посреди бизнес-логики, «чтобы не падало», прячет баги и оставляет систему в неизвестном состоянии.</li><li><strong>Ловить на границах</strong>: middleware ASP.NET Core, обработчик сообщения в потребителе очереди, тело <code>BackgroundService</code>. Там исключение логируется один раз с контекстом и превращается в ответ (<code>ProblemDetails</code>), повтор или отправку сообщения в DLQ. Логирование и проброс на каждом уровне дают пять записей об одной ошибке.</li><li><strong>Ожидаемые бизнес-неудачи</strong> («недостаточно товара на складе», «заказ уже отгружен») — не исключения, а результат: <code>Result&lt;T&gt;</code>, собственные типы-результаты, коды ошибок. Их проверяют в коде явно, они дешёвые и видны в сигнатуре.</li><li><strong><code>OperationCanceledException</code></strong> при отмене запроса — не ошибка: её ловят отдельно (или фильтром <code>when (ct.IsCancellationRequested)</code>) и не пишут в лог как сбой.</li><li>Собственные исключения стоит заводить, когда вызывающему нужно <strong>различать</strong> ситуации в <code>catch</code>; иначе хватает стандартных <code>ArgumentException</code>, <code>InvalidOperationException</code>, <code>NotSupportedException</code>. Проверки аргументов — через <code>ArgumentNullException.ThrowIfNull</code>, <code>ArgumentOutOfRangeException.ThrowIfNegative</code> и подобные статические помощники.</li></ul>
<p><strong>Throw helpers</strong> — приём из BCL, который полезно знать: JIT неохотно инлайнит методы, содержащие <code>throw</code>, потому что код броска (создание исключения, форматирование сообщения) большой. Если вынести бросок в отдельный статический метод (<code>ThrowHelper.ThrowArgumentOutOfRange()</code>, помеченный <code>[DoesNotReturn]</code>), горячий метод становится маленьким и инлайнится, а холодный путь уезжает в сторону. Именно так устроены помощники <code>ThrowIfNull</code> и <code>ThrowIfNegative</code>.</p>
<h3>JIT и tiered compilation</h3>
<p>Сборка содержит <strong>IL</strong> — промежуточный код. Машинный код создаёт <strong>JIT</strong> при первом вызове метода: до этого вызов идёт через заглушку, которая запускает компиляцию и подменяет адрес. Компилировать всё сразу с максимальной оптимизацией — значит долго стартовать, поэтому с .NET Core 3.0 по умолчанию включена <strong>tiered compilation</strong>:</p>
<ul><li><strong>Tier 0</strong> — быстрая компиляция почти без оптимизаций, чтобы приложение быстро запустилось;</li><li>рантайм <strong>считает вызовы</strong>; метод, вызванный достаточно часто (порог — около 30 вызовов), перекомпилируется в <strong>Tier 1</strong> с полной оптимизацией в фоновом потоке, и дальнейшие вызовы идут в новый код;</li><li>методы с циклами раньше сразу компилировались с оптимизацией (иначе долгий цикл навсегда застрял бы в медленном коде); с .NET 7 включён <strong>OSR</strong> (On-Stack Replacement) — переход из Tier 0 в оптимизированную версию прямо посреди выполняющегося цикла;</li><li>в Tier 1 значения <code>static readonly</code>-полей уже известны, и JIT использует их как <strong>константы</strong>: ветка <code>if (s_featureEnabled)</code> может полностью исчезнуть.</li></ul>
<p><strong>Dynamic PGO</strong> (Profile-Guided Optimization), включённая по умолчанию с .NET 8: горячие методы перед финальной оптимизацией проходят через <strong>инструментированную</strong> версию, которая собирает профиль — какие конкретные типы приходят в виртуальные и интерфейсные вызовы, какие ветки горячие. Оптимизированная версия использует профиль: <strong>guarded devirtualization</strong> («если объект — <code>List&lt;int&gt;</code>, вызови метод напрямую и заинлайнь, иначе — обычный виртуальный вызов»), раскладка горячего и холодного кода. Поэтому вызов через интерфейс в горячем пути часто стоит почти как прямой.</p>
<p>Практические следствия: первые запросы к сервису медленнее (прогрев), бенчмарк без прогрева измеряет Tier 0 — <strong>BenchmarkDotNet делает прогрев сам</strong>, поэтому самописный <code>Stopwatch</code> в цикле врёт.</p>
<h3>ReadyToRun</h3>
<p><strong>ReadyToRun</strong> (<code>&lt;PublishReadyToRun&gt;true&lt;/PublishReadyToRun&gt;</code>) заранее компилирует IL в машинный код и кладёт его в сборку рядом с IL. Старт заметно быстрее (меньше работы JIT), сборки больше и привязаны к платформе. Предкомпилированный код менее оптимален (он не знает точного процессора и не может инлайнить через границы версий сборок), поэтому горячие методы рантайм всё равно перекомпилирует в Tier 1. Сама библиотека классов .NET поставляется в формате ReadyToRun. Это компромисс: быстрый старт плюс полная мощь JIT.</p>
<h3>NativeAOT</h3>
<p><strong>NativeAOT</strong> (<code>&lt;PublishAot&gt;true&lt;/PublishAot&gt;</code>) компилирует <strong>всё приложение вместе с рантаймом</strong> в один нативный исполняемый файл. JIT в процессе нет вообще. Плюсы: старт за миллисекунды, меньше потребление памяти, маленький образ контейнера, не нужен установленный .NET. Применение: CLI-утилиты, serverless-функции, sidecar-ы, сервисы, которые часто масштабируются с нуля.</p>
<p>Ограничения — следствие отсутствия JIT и обязательного <strong>trimming</strong> (удаления неиспользуемого кода):</p>
<ul><li><strong>нет генерации кода в рантайме</strong>: <code>Reflection.Emit</code> не работает, <code>Expression.Compile()</code> выполняется интерпретатором (медленно);</li><li>нельзя загрузить новую сборку в рантайме (плагины через <code>Assembly.LoadFrom</code>);</li><li>reflection работает только для того, что компилятор увидел или что помечено атрибутами (<code>DynamicallyAccessedMembers</code>); trimmer выдаёт предупреждения, которые нужно разбирать, а не подавлять;</li><li><code>MakeGenericType</code> с неизвестными на этапе компиляции value-type-аргументами может не работать — нужного кода просто нет;</li><li>сериализация — через source generators (<code>System.Text.Json</code> с <code>JsonSerializerContext</code>);</li><li>в ASP.NET Core поддерживаются minimal APIs (<code>WebApplication.CreateSlimBuilder</code>), но <strong>не MVC-контроллеры</strong>; поддержка в EF Core ограничена;</li><li>сборка под конкретную ОС и архитектуру, на машине с нативным тулчейном целевой платформы;</li><li>нет tiered compilation и Dynamic PGO, поэтому пиковая производительность долгоживущего сервиса может быть <strong>ниже</strong>, чем у JIT.</li></ul>
<h3>Reflection против source generators</h3>
<p><strong>Reflection</strong> читает метаданные в рантайме: найти тип, перечислить свойства, вызвать метод по имени. Это медленно (поиск по метаданным, проверки, упаковка аргументов в <code>object[]</code>), плохо дружит с trimming и NativeAOT, а ошибки видны только при выполнении. Если reflection неизбежен — кешируют <code>PropertyInfo</code>/<code>MethodInfo</code> и строят делегаты один раз. Для доступа к приватному члену без reflection в .NET 8 появился <strong><code>[UnsafeAccessor]</code></strong>:</p>
<pre><code>[UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_secret")]
static extern ref string SecretOf(LegacyService service);

ref string secret = ref SecretOf(service);  // прямой доступ к приватному полю, без reflection</code></pre>
<p><strong>Source generators</strong> — расширения компилятора Roslyn (<code>IIncrementalGenerator</code>), которые генерируют C#-код <strong>во время компиляции</strong> по вашему коду и атрибутам. Сгенерированный код — обычный C#: его видно в IDE, он отлаживается, совместим с AOT, не тратит время при старте. Примеры из BCL и ASP.NET Core:</p>
<ul><li><code>System.Text.Json</code>: <code>[JsonSerializable(typeof(Order))]</code> на наследнике <code>JsonSerializerContext</code> — сериализатор без reflection;</li><li><code>[GeneratedRegex("...")]</code> (.NET 7) — регулярное выражение, скомпилированное в C# при сборке;</li><li><code>[LoggerMessage]</code> — высокопроизводительное логирование без упаковки аргументов и парсинга шаблона на каждом вызове;</li><li><code>[LibraryImport]</code> (.NET 7) — генерация маршалинга для P/Invoke вместо рантаймового в <code>DllImport</code>;</li><li>генератор привязки конфигурации и генератор делегатов запросов для minimal APIs (.NET 8).</li></ul>
<p>Сторонние примеры, которые стоит упомянуть: Mapperly вместо AutoMapper, генераторы для Mediator. Аргумент на собеседовании: перенос работы из рантайма в компиляцию — быстрее старт, меньше памяти, ошибки на этапе сборки, совместимость с trimming.</p>
<h3>Что спросят на собеседовании</h3>
<details><summary>«Почему исключения дорогие? Чем их заменить?»</summary>
<p>Блок <code>try</code> без броска почти ничего не стоит — дорого именно <strong>бросание</strong>. Создаётся объект исключения, захватывается трассировка стека, а обработка идёт в два прохода: сначала рантайм ищет подходящий <code>catch</code>, поднимаясь по кадрам и вычисляя фильтры <code>when</code>, затем раскручивает стек, выполняя <code>finally</code> и <code>using</code> всех пройденных кадров. Это микросекунды — незаметно для редкой ошибки и катастрофично, если исключения управляют потоком на тысячах запросов в секунду. В .NET 9 обработку переписали на управляемый код, и она стала в несколько раз быстрее, но правило не изменилось.</p>
<p>Для ожидаемых неудач — Try-паттерн (<code>TryParse</code>, <code>TryGetValue</code>), валидация до операции и Result-паттерн: <code>Result&lt;T&gt;</code> с ошибкой вместо броска. Это дёшево и видно в сигнатуре. Исключения остаются для исключительных ситуаций: недоступна база, нарушен инвариант, баг.</p>
</details>
<details><summary>«Чем throw отличается от throw ex?»</summary>
<ul><li><code>throw;</code> пробрасывает то же исключение с <strong>исходной трассировкой</strong> — это правильный проброс после логирования.</li><li><code>throw ex;</code> перезаписывает трассировку: стек начнётся с этой строки, и место, где ошибка реально произошла, теряется. Анализаторы об этом предупреждают.</li><li><code>throw new DomainException("...", ex);</code> — когда нужно добавить смысл, сохранив исходное исключение в <code>InnerException</code>.</li><li><code>ExceptionDispatchInfo.Capture(ex).Throw()</code> — бросить захваченное исключение позже или в другом месте (в другом потоке, после цикла), сохранив исходную трассировку и дописав новую точку. Именно так <code>await</code> пробрасывает исключение из задачи.</li></ul>
<p>Ещё один близкий факт: исключение, брошенное в <code>finally</code> или в <code>Dispose</code> внутри <code>using</code>, <strong>заменяет</strong> исходное, и первоначальная ошибка теряется — поэтому <code>Dispose</code> не должен бросать.</p>
</details>
<details><summary>«Зачем нужны фильтры исключений?»</summary>
<p>Фильтр <code>catch (X ex) when (условие)</code> вычисляется <strong>на первом проходе, до раскрутки стека</strong>. Отсюда преимущества перед <code>catch { if (!условие) throw; }</code>:</p>
<ul><li>если фильтр вернул <code>false</code>, исключение летит дальше так, будто этого <code>catch</code> нет: стек и место броска не тронуты, и дамп при падении покажет исходную точку;</li><li>можно логировать, не перехватывая: <code>catch (Exception ex) when (Log(ex))</code>, где <code>Log</code> возвращает <code>false</code>;</li><li>удобно разбирать по свойствам: обработать только 404 у <code>HttpRequestException</code>, а остальные коды отпустить; или отделить отмену — <code>when (ct.IsCancellationRequested)</code>.</li></ul>
<p>Нюанс: исключение, брошенное внутри фильтра, проглатывается, и фильтр считается вернувшим <code>false</code>. И стоит помнить, что в момент вычисления фильтра <code>finally</code> вложенных вызовов ещё не выполнены.</p>
</details>
<details><summary>«Что выполнится раньше: фильтр when во внешнем методе или finally во вложенном?»</summary>
<p><strong>Фильтр.</strong> Обработка исключения двухпроходная: на первом проходе рантайм поднимается по кадрам вверх и вычисляет фильтры, чтобы найти обработчик, — стек в этот момент ещё не раскручен, и <code>finally</code> вложенных методов не выполнялись. Только когда обработчик найден, начинается второй проход: раскрутка с выполнением всех <code>finally</code> и <code>Dispose</code> между местом броска и найденным <code>catch</code>, и лишь потом тело <code>catch</code>.</p>
<pre><code>void Inner() { try { throw new Exception(); } finally { Console.Write("F "); } }
try { Inner(); }
catch when (Mark("W ")) { Console.Write("C "); }  // выведет: W F C
// Mark пишет строку и возвращает true</code></pre>
<p>Практическое следствие: в фильтре нельзя полагаться на то, что ресурсы вложенного кода уже освобождены или блокировки отпущены, — зато в нём видно состояние ровно на момент ошибки, что и делает фильтры удобными для логирования.</p>
</details>
<details><summary>«Где и как ловить исключения в сервисе?»</summary>
<p>Ловить там, где можно <strong>что-то сделать</strong>: повторить запрос, перевести в другой код ответа, вернуть значение по умолчанию. <code>catch (Exception) { }</code> посреди бизнес-логики, «чтобы не падало», прячет баги и оставляет систему в неизвестном состоянии.</p>
<p>Остальное ловится <strong>на границах</strong>: middleware ASP.NET Core или <code>IExceptionHandler</code> (.NET 8), отдающие <code>ProblemDetails</code>; обработчик сообщения в потребителе очереди, который решает, повторять или отправить в DLQ; тело <code>BackgroundService</code>. Там исключение логируется <strong>один раз</strong> с контекстом — логирование и проброс на каждом уровне дают пять записей об одной ошибке.</p>
<p>Ожидаемые бизнес-неудачи («недостаточно товара», «заказ уже отгружен») — не исключения, а результат: <code>Result&lt;T&gt;</code> или коды ошибок. <code>OperationCanceledException</code> при отмене запроса — не сбой, её не пишут в лог как ошибку. Свои исключения завожу, только когда вызывающему нужно их различать в <code>catch</code>; иначе хватает <code>ArgumentException</code>, <code>InvalidOperationException</code> и помощников <code>ThrowIfNull</code>/<code>ThrowIfNegative</code>.</p>
</details>
<details><summary>«Что такое tiered compilation и Dynamic PGO?»</summary>
<p>IL компилируется JIT при первом вызове метода. Чтобы приложение быстро стартовало, с .NET Core 3.0 включена <strong>tiered compilation</strong>:</p>
<ul><li><strong>Tier 0</strong> — быстрая компиляция почти без оптимизаций;</li><li>рантайм считает вызовы, и метод, вызванный достаточно часто (около 30 раз), в фоне перекомпилируется в <strong>Tier 1</strong> с полной оптимизацией; в Tier 1 значения <code>static readonly</code>-полей уже известны и используются как константы, так что ветка по выключенному флагу может исчезнуть;</li><li>для долгих циклов с .NET 7 есть <strong>OSR</strong> — переход в оптимизированную версию прямо посреди выполняющегося цикла.</li></ul>
<p><strong>Dynamic PGO</strong> (по умолчанию с .NET 8): горячий метод перед финальной оптимизацией проходит через инструментированную версию, которая собирает профиль — какие типы приходят в виртуальные и интерфейсные вызовы, какие ветки горячие. Дальше <strong>guarded devirtualization</strong>: «если это <code>List&lt;int&gt;</code> — прямой вызов и инлайн, иначе обычный виртуальный», плюс раскладка горячего и холодного кода. Поэтому интерфейсный вызов в горячем пути часто стоит почти как прямой.</p>
<p>Практика: первые запросы медленнее — нужен прогрев; бенчмарк без прогрева меряет Tier 0, поэтому <code>Stopwatch</code> в цикле врёт, а BenchmarkDotNet прогревает сам.</p>
</details>
<details><summary>«ReadyToRun и NativeAOT — в чём разница, когда что?»</summary>
<p><strong>ReadyToRun</strong> заранее компилирует IL в машинный код и кладёт его в сборку <strong>рядом с IL</strong>. Старт быстрее, сборки больше и привязаны к платформе. Предкомпилированный код менее оптимален — не знает точного процессора и не инлайнит через границы версий сборок, — поэтому горячие методы рантайм всё равно перекомпилирует в Tier 1. Это компромисс: быстрый старт плюс вся мощь JIT. Сама BCL поставляется в R2R.</p>
<p><strong>NativeAOT</strong> компилирует всё приложение с рантаймом в один нативный файл, <strong>JIT в процессе нет</strong>. Старт за миллисекунды, меньше памяти, маленький образ, не нужен установленный .NET. Цена — ограничения: нет <code>Reflection.Emit</code>, <code>Expression.Compile()</code> работает через интерпретатор, нельзя грузить сборки в рантайме, reflection — только для увиденного компилятором или помеченного атрибутами, обязательный trimming с предупреждениями, сериализация через source generators, в ASP.NET Core — minimal APIs, но не MVC-контроллеры. И без tiered compilation и PGO пиковая производительность долгоживущего сервиса может быть ниже, чем у JIT.</p>
<p>Выбор: NativeAOT — CLI-утилиты, serverless, sidecar-ы, сервисы, часто стартующие с нуля; ReadyToRun — когда нужен быстрый старт обычного сервиса без ограничений AOT; JIT по умолчанию — для долгоживущих сервисов, где важна пиковая производительность.</p>
</details>
<details><summary>«Почему source generators лучше reflection?»</summary>
<p>Reflection читает метаданные в рантайме: поиск по метаданным, проверки, упаковка аргументов в <code>object[]</code> — это медленно, плохо дружит с trimming и NativeAOT, а ошибки видны только при выполнении. Если без него не обойтись — кешируют <code>PropertyInfo</code>/<code>MethodInfo</code> и строят делегаты один раз; для доступа к приватному члену с .NET 8 есть <code>[UnsafeAccessor]</code>.</p>
<p>Source generators (<code>IIncrementalGenerator</code> в Roslyn) генерируют обычный C# <strong>во время компиляции</strong>: его видно в IDE, он отлаживается, совместим с AOT, не тратит время на старте, а ошибки ловятся при сборке. Примеры из BCL:</p>
<ul><li><code>System.Text.Json</code> с <code>JsonSerializerContext</code> и <code>[JsonSerializable]</code>;</li><li><code>[GeneratedRegex]</code> — регулярка, скомпилированная в C# при сборке;</li><li><code>[LoggerMessage]</code> — логирование без упаковки аргументов и парсинга шаблона;</li><li><code>[LibraryImport]</code> — маршалинг P/Invoke, сгенерированный заранее;</li><li>привязка конфигурации и делегаты запросов minimal APIs.</li></ul>
<p>Из сторонних — Mapperly вместо AutoMapper. Итоговый аргумент: перенос работы из рантайма в компиляцию — быстрее старт, меньше памяти, ошибки на этапе сборки, совместимость с trimming.</p>
</details>` },
    { id: `new`, title: `Новое в C# 12–14 и .NET 8–10`, html: `<h3>Версии и поддержка</h3>
<table><thead><tr><th>Версия</th><th>Вышла</th><th>Тип</th><th>Язык</th></tr></thead><tbody><tr><td>.NET 8</td><td>ноябрь 2023</td><td>LTS, поддержка до ноября 2026</td><td>C# 12</td></tr><tr><td>.NET 9</td><td>ноябрь 2024</td><td>STS, поддержка до ноября 2026</td><td>C# 13</td></tr><tr><td>.NET 10</td><td>ноябрь 2025</td><td>LTS, поддержка до ноября 2028</td><td>C# 14</td></tr></tbody></table>
<p>Релизы выходят каждый ноябрь, чётные версии — LTS на три года, нечётные — STS, которым с .NET 9 продлили поддержку с 18 до 24 месяцев (поэтому .NET 9 заканчивается в один день с .NET 8 — 10 ноября 2026). Осенью 2026 года это особенно актуально: <strong>поддержка .NET 8 заканчивается в ноябре 2026</strong>, и вопрос «переводили ли вы сервисы на .NET 10 и что при этом всплыло» вполне вероятен. Хороший ответ: обновили <code>TargetFramework</code> и пакеты, прогнали тесты и нагрузку, посмотрели на предупреждения анализаторов и breaking changes, сравнили метрики GC и latency до и после.</p>
<p>Ниже — то, о чём действительно спрашивают, а не полный список изменений.</p>
<h3>C# 12 (.NET 8)</h3>
<p><strong>Primary constructors для классов и структур.</strong></p>
<pre><code>public class OrderService(IOrderRepository repository, ILogger&lt;OrderService&gt; logger)
{
    public async Task ShipAsync(Guid id, CancellationToken ct)
    {
        var order = await repository.GetAsync(id, ct);
        logger.LogInformation("Shipping {OrderId}", id);
        order.Ship();
    }
}</code></pre>
<p>Важно понимать, чем они <strong>не</strong> являются:</p>
<ul><li>параметры primary constructor у класса — <strong>не свойства</strong> (в отличие от <code>record</code>, где из позиционных параметров генерируются публичные свойства);</li><li>если параметр используется в членах класса, компилятор <strong>захватывает</strong> его в скрытое поле;</li><li>этот параметр <strong>изменяемый</strong>: его можно переприсвоить в любом методе, <code>readonly</code> для него написать нельзя. Команды, которым это важно, явно присваивают параметр в <code>private readonly</code>-поле;</li><li>ловушка двойного хранения: если параметр и присвоить в поле, и использовать напрямую в методе, получится <strong>две копии</strong> состояния — компилятор предупреждает (CS9124).</li></ul>
<p><strong>Collection expressions</strong> — единый синтаксис создания коллекций, целевой тип определяет реализацию:</p>
<pre><code>int[] ids = [1, 2, 3];
List&lt;string&gt; names = [];
Span&lt;byte&gt; header = [0x50, 0x4B];
ImmutableArray&lt;int&gt; frozen = [1, 2, 3];
int[] all = [..ids, 4, 5];     // spread-оператор
// var x = [1, 2];             // ошибка: у выражения нет «естественного» типа</code></pre>
<p>Компилятор сам выбирает эффективный способ построения (с заранее известным размером, без лишних копий); поддержку для своих типов дают атрибутом <code>[CollectionBuilder]</code>.</p>
<p>Остальное из C# 12, что стоит знать по названию: <strong>алиасы для любых типов</strong> (<code>using Point = (int X, int Y);</code>), <strong>параметры лямбд по умолчанию</strong> (<code>var add = (int a, int b = 1) =&gt; a + b;</code>), <strong>inline arrays</strong> (<code>[InlineArray(8)]</code> — буфер фиксированного размера внутри структуры), <code>ref readonly</code>-параметры, атрибут <code>[Experimental]</code>.</p>
<h3>.NET 8</h3>
<ul><li><strong>Frozen-коллекции</strong> — <code>FrozenDictionary</code>, <code>FrozenSet</code>: долгое создание, быстрое чтение (подробно — в главе о коллекциях).</li><li><strong><code>TimeProvider</code></strong> — абстракция времени в BCL. Вместо <code>DateTime.UtcNow</code> прямо в коде — зависимость, которую в тестах подменяют:</li></ul>
<pre><code>public class ReservationService(TimeProvider time)
{
    public bool IsExpired(Reservation r) =&gt; time.GetUtcNow() &gt;= r.ExpiresAt;
}

// продакшен: services.AddSingleton(TimeProvider.System);
// тест (пакет Microsoft.Extensions.TimeProvider.Testing):
var fake = new FakeTimeProvider();
var service = new ReservationService(fake);
fake.Advance(TimeSpan.FromHours(2));   // «перемотали» время, без Thread.Sleep</code></pre>
<p><code>TimeProvider</code> умеет и таймеры (<code>CreateTimer</code>), а <code>Task.Delay</code> и <code>CancellationTokenSource</code> получили перегрузки, принимающие его, — тесты с таймаутами становятся детерминированными.</p>
<ul><li><strong>Keyed services</strong> в DI: несколько реализаций одного интерфейса по ключу.</li></ul>
<pre><code>builder.Services.AddKeyedSingleton&lt;IStorage, S3Storage&gt;("s3");
builder.Services.AddKeyedSingleton&lt;IStorage, LocalStorage&gt;("local");

public class Exporter([FromKeyedServices("s3")] IStorage storage) { }</code></pre>
<ul><li><strong><code>IExceptionHandler</code></strong> в ASP.NET Core — обработчики исключений как сервисы, поверх <code>UseExceptionHandler</code>.</li><li><strong><code>SearchValues&lt;T&gt;</code></strong> — заранее подготовленный набор значений для быстрого <code>IndexOfAny</code>/<code>ContainsAny</code>.</li><li><strong><code>[UnsafeAccessor]</code></strong> — доступ к приватным членам без reflection.</li><li><strong><code>ConfigureAwaitOptions</code></strong> (<code>SuppressThrowing</code>, <code>ForceYielding</code>).</li><li><code>Random.Shared.GetItems</code> и <code>Shuffle</code>, политики имён <code>JsonNamingPolicy.SnakeCaseLower</code> и <code>KebabCaseLower</code> в <code>System.Text.Json</code>.</li><li><strong>NativeAOT для ASP.NET Core</strong> (minimal APIs), <strong>DATAS</strong> для Server GC (по умолчанию — с .NET 9), Dynamic PGO по умолчанию.</li></ul>
<h3>C# 13 (.NET 9)</h3>
<ul><li><strong><code>params</code> для коллекций</strong>: <code>params</code> теперь можно писать не только с массивом, но и с <code>Span&lt;T&gt;</code>, <code>ReadOnlySpan&lt;T&gt;</code>, <code>IEnumerable&lt;T&gt;</code>, <code>List&lt;T&gt;</code> и другими. С <code>params ReadOnlySpan&lt;T&gt;</code> вызов с несколькими аргументами не выделяет массив:</li></ul>
<pre><code>public static void LogTags(params ReadOnlySpan&lt;string&gt; tags)
{
    foreach (var t in tags) Console.Write(t);
}
LogTags("a", "b", "c");   // аргументы — во временном буфере на стеке, без new string[3]</code></pre>
<ul><li><strong>Новый тип <code>Lock</code></strong> и его поддержка оператором <code>lock</code> (см. главу о потоках).</li><li><strong><code>ref struct</code> и интерфейсы</strong>: <code>ref struct</code> может реализовывать интерфейс, а generic-параметр может разрешить <code>ref struct</code> через <code>where T : allows ref struct</code>; в async- и iterator-методах разрешены <code>ref</code>-локальные переменные и <code>ref struct</code>, если они не пересекают <code>await</code>/<code>yield</code>.</li><li><strong>Partial properties</strong> — объявление свойства в одной части partial-класса и реализация в другой (полезно для source generators).</li><li>Атрибут <code>[OverloadResolutionPriority]</code> для авторов библиотек, escape-последовательность <code>\\e</code>, неявный индекс «с конца» (<code>^1</code>) в инициализаторах объектов.</li></ul>
<h3>.NET 9</h3>
<ul><li><strong>LINQ</strong>: <code>CountBy</code>, <code>AggregateBy</code>, <code>Index</code>.</li><li><strong><code>Task.WhenEach</code></strong> — перебор задач в порядке завершения через <code>await foreach</code>.</li><li><strong><code>Guid.CreateVersion7()</code></strong> — UUIDv7 с временной меткой в старших битах: идентификаторы, генерируемые в приложении, монотонно растут, что хорошо для B-tree-индексов в PostgreSQL и SQL Server (меньше разбиений страниц, чем у случайных v4).</li><li><strong><code>HybridCache</code></strong> (пакет <code>Microsoft.Extensions.Caching.Hybrid</code>) — двухуровневый кеш (в памяти процесса + распределённый, например Redis) с защитой от «stampede»: при промахе фабрика для одного ключа выполняется один раз, остальные ждут её результата. Это решение проблемы, которую <code>GetOrAdd</code> у <code>ConcurrentDictionary</code> и <code>IMemoryCache.GetOrCreate</code> не решают.</li><li>Встроенная генерация OpenAPI-документа в ASP.NET Core (<code>Microsoft.AspNetCore.OpenApi</code>) — шаблоны больше не подключают Swashbuckle по умолчанию.</li><li>Переписанная обработка исключений — заметно быстрее; DATAS включён по умолчанию для Server GC.</li></ul>
<h3>C# 14 (.NET 10)</h3>
<p><strong>Extension members</strong> — новый синтаксис расширений: блок <code>extension</code> внутри статического класса, в котором можно объявлять не только методы, но и <strong>свойства</strong> и <strong>статические члены</strong> расширяемого типа.</p>
<pre><code>public static class EnumerableExtensions
{
    extension&lt;T&gt;(IEnumerable&lt;T&gt; source)            // получатель с именем — для экземплярных членов
    {
        public bool IsEmpty =&gt; !source.Any();       // extension-свойство
        public IEnumerable&lt;T&gt; WhereNotNull() =&gt; source.Where(x =&gt; x is not null);
    }

    extension&lt;T&gt;(IEnumerable&lt;T&gt;)                    // без имени — для статических членов
    {
        public static IEnumerable&lt;T&gt; None =&gt; Enumerable.Empty&lt;T&gt;(); // вызов: IEnumerable&lt;int&gt;.None
    }
}

if (orders.IsEmpty) return;</code></pre>
<p>Старые extension-методы с <code>this</code> продолжают работать и совместимы с новыми.</p>
<p><strong>Ключевое слово <code>field</code></strong> — доступ к автоматически созданному backing field из аксессора свойства, без объявления поля вручную:</p>
<pre><code>public string Sku
{
    get;
    set =&gt; field = value?.Trim().ToUpperInvariant()
                   ?? throw new ArgumentNullException(nameof(value));
}</code></pre>
<p>Если в типе уже есть член с именем <code>field</code>, внутри аксессора его придётся писать как <code>@field</code> или <code>this.field</code>.</p>
<p><strong>Null-conditional присваивание</strong>: <code>order?.Status = OrderStatus.Shipped;</code> — присваивание выполняется, только если <code>order</code> не <code>null</code>, и <strong>правая часть тогда не вычисляется</strong>. Работает и с составным присваиванием (<code>counter?.Value += 1</code>).</p>
<p>Ещё в C# 14:</p>
<ul><li><code>nameof</code> с несвязанным generic-типом: <code>nameof(List&lt;&gt;)</code> — <code>"List"</code>;</li><li><strong>неявные преобразования к <code>Span&lt;T&gt;</code> и <code>ReadOnlySpan&lt;T&gt;</code></strong> стали частью языка («first-class spans»): массивы и спаны свободнее передаются в API, принимающие спаны, в том числе как получатели extension-методов;</li><li>модификаторы у параметров лямбд без указания типов: <code>(text, out result) =&gt; int.TryParse(text, out result)</code>;</li><li>partial-конструкторы и partial-события, пользовательские составные операторы присваивания (<code>operator +=</code>).</li></ul>
<h3>.NET 10</h3>
<ul><li><strong>LTS</strong> до ноября 2028 — основная цель миграции для сервисов на .NET 8.</li><li><strong>LINQ</strong>: <code>LeftJoin</code> и <code>RightJoin</code>; LINQ для <code>IAsyncEnumerable&lt;T&gt;</code> в составе BCL (<code>System.Linq.AsyncEnumerable</code>).</li><li><strong>File-based apps</strong>: <code>dotnet run app.cs</code> запускает одиночный файл без проекта — удобно для скриптов и утилит.</li><li><strong>JIT</strong>: расширенный escape analysis — небольшие объекты и массивы, не покидающие метод, могут размещаться на стеке; дальнейшая девиртуализация. Именно поэтому «объект всегда в куче» — упрощение.</li><li>В ASP.NET Core 10 — встроенная валидация для minimal APIs и OpenAPI 3.1, в EF Core 10 — поддержка новых <code>LeftJoin</code>/<code>RightJoin</code> и именованные query filters (несколько фильтров на сущность, отключаемых по отдельности — полезно, когда soft delete и мультитенантность живут рядом).</li></ul>
<h3>Как об этом говорить на собеседовании</h3>
<p>Интервьюер редко ждёт перечисления фич. Хороший ответ связывает фичу с проблемой: «<code>TimeProvider</code> убрал из тестов <code>Thread.Sleep</code> и самописные <code>IClock</code>», «<code>HybridCache</code> закрыл cache stampede на холодном старте», «<code>Guid.CreateVersion7</code> дал монотонные ключи для индексов», «<code>Lock</code> и <code>params ReadOnlySpan</code> — это про меньше аллокаций и понятнее намерение», «primary constructors сократили DI-boilerplate, но параметры изменяемы — у нас правило анализатора». Если с чем-то не работали — честно сказать, что знаете о фиче и где бы применили.</p>
<h3>Что спросят на собеседовании</h3>
<details><summary>«Что нового в последних версиях C#, чем пользовались?»</summary>
<p>Отвечаю не списком фич, а связкой «фича — проблема, которую она решила»:</p>
<ul><li><strong>C# 12</strong>: primary constructors сократили DI-boilerplate (с оговоркой про изменяемость параметров), collection expressions (<code>int[] ids = [1, 2, 3]</code>, spread <code>..</code>) дали единый синтаксис, где компилятор сам выбирает эффективное построение;</li><li><strong>C# 13</strong>: <code>params ReadOnlySpan&lt;T&gt;</code> — вызов с несколькими аргументами без аллокации массива; новый <code>Lock</code> с поддержкой оператора <code>lock</code>; partial properties для source generators;</li><li><strong>C# 14</strong>: extension members — extension-свойства и статические расширения; ключевое слово <code>field</code> убрало ручные backing fields ради валидации в сеттере; null-conditional присваивание <code>order?.Status = ...</code>.</li></ul>
<p>Из BCL — <code>TimeProvider</code> для тестируемого времени, keyed services в DI, <code>Guid.CreateVersion7()</code> для монотонных ключей, <code>HybridCache</code> против cache stampede, <code>Task.WhenEach</code>, <code>CountBy</code>/<code>AggregateBy</code>, в .NET 10 <code>LeftJoin</code>. Если чем-то не пользовался — честно говорю, что знаю о фиче и где бы применил.</p>
</details>
<details><summary>«Чем primary constructor класса отличается от позиционного record?»</summary>
<p>У позиционного <code>record</code> параметры превращаются в <strong>публичные <code>init</code>-свойства</strong>, плюс генерируются равенство по значению, <code>Deconstruct</code>, <code>ToString</code> и <code>with</code>. У обычного класса с primary constructor ничего этого нет:</p>
<ul><li>параметры <strong>не свойства</strong> — снаружи их не видно;</li><li>если параметр используется в членах класса, компилятор захватывает его в скрытое поле;</li><li>этот параметр <strong>изменяемый</strong>: его можно переприсвоить в любом методе, а <code>readonly</code> для него написать нельзя;</li><li>если параметр и присвоить в поле, и использовать напрямую, получится <strong>две копии</strong> состояния, которые могут разойтись, — компилятор предупреждает (CS9124).</li></ul>
<p>На практике primary constructors хороши для DI-сервисов: <code>class OrderService(IOrderRepository repository, ILogger&lt;OrderService&gt; logger)</code>. Команды, которым важна неизменяемость, явно присваивают параметр в <code>private readonly</code>-поле или включают правило анализатора, запрещающее переприсваивание.</p>
</details>
<details><summary>«Зачем нужен TimeProvider?»</summary>
<p>Чтобы время стало <strong>зависимостью</strong>, а не глобальным состоянием. Код с <code>DateTime.UtcNow</code> внутри трудно тестировать: проверка «бронь истекла через два часа» требует либо ждать, либо писать самодельный <code>IClock</code>. <code>TimeProvider</code> (.NET 8) — стандартная абстракция в BCL: в продакшене регистрируют <code>TimeProvider.System</code>, в тестах — <code>FakeTimeProvider</code> из пакета <code>Microsoft.Extensions.TimeProvider.Testing</code>, и время «перематывают» через <code>fake.Advance(TimeSpan.FromHours(2))</code>.</p>
<p>Важно, что он покрывает не только «текущее время», но и таймеры: <code>CreateTimer</code>, а <code>Task.Delay</code> и <code>CancellationTokenSource</code> получили перегрузки, принимающие <code>TimeProvider</code>. Поэтому тесты с таймаутами, ретраями и истечением кеша становятся детерминированными и быстрыми, без <code>Thread.Sleep</code>. Стандартный тип вместо самописного интерфейса ещё и понятен любой библиотеке.</p>
</details>
<details><summary>«Что такое extension members в C# 14?»</summary>
<p>Новый синтаксис расширений: внутри статического класса объявляется блок <code>extension</code> с получателем, и в нём можно писать не только методы, но и <strong>свойства</strong> и <strong>статические члены</strong> расширяемого типа.</p>
<pre><code>public static class EnumerableExtensions
{
    extension&lt;T&gt;(IEnumerable&lt;T&gt; source)
    {
        public bool IsEmpty =&gt; !source.Any();          // extension-свойство
    }
    extension&lt;T&gt;(IEnumerable&lt;T&gt;)
    {
        public static IEnumerable&lt;T&gt; None =&gt; Enumerable.Empty&lt;T&gt;(); // IEnumerable&lt;int&gt;.None
    }
}</code></pre>
<p>Блок с именованным получателем — для экземплярных членов, без имени — для статических. Раньше extension-свойств не было вовсе, и приходилось писать <code>IsEmpty()</code> как метод. Старые extension-методы с <code>this</code> продолжают работать и совместимы с новыми, так что мигрировать ничего не нужно.</p>
</details>
<details><summary>«Что делает ключевое слово field?»</summary>
<p>Даёт доступ к автоматически созданному backing field прямо из аксессора свойства. Раньше, чтобы добавить в сеттер нормализацию или валидацию, приходилось превращать автосвойство в полное и объявлять поле руками; теперь достаточно:</p>
<pre><code>public string Sku
{
    get;
    set =&gt; field = value?.Trim().ToUpperInvariant()
                   ?? throw new ArgumentNullException(nameof(value));
}</code></pre>
<p>Поле остаётся скрытым и недоступным остальному классу, то есть обойти логику сеттера нельзя — это плюс по сравнению с ручным полем. Тонкость совместимости: если в типе уже есть член с именем <code>field</code>, внутри аксессора к нему придётся обращаться через <code>@field</code> или <code>this.field</code>.</p>
</details>
<details><summary>«Почему UUIDv7 лучше v4 для первичного ключа?»</summary>
<p><code>Guid.NewGuid()</code> даёт UUIDv4 — полностью случайный. Для B-tree-индекса это плохо: каждая вставка попадает в случайное место индекса, страницы постоянно делятся, индекс фрагментируется и хуже держится в кеше. <code>Guid.CreateVersion7()</code> (.NET 9) кладёт <strong>временную метку в старшие биты</strong>, поэтому идентификаторы, сгенерированные в приложении, монотонно растут, и вставки идут в «правый край» индекса — как у автоинкремента, с меньшим числом разбиений страниц. Это хорошо работает, например, в PostgreSQL.</p>
<p>При этом сохраняются плюсы GUID: id генерируется в приложении без похода в базу, глобально уникален, годится для распределённых систем и идемпотентных повторов. Обратная сторона — из v7 можно прочитать время создания записи, поэтому для публичных идентификаторов, где это нежелательно, стоит подумать.</p>
</details>
<details><summary>«Какие версии .NET — LTS? Когда заканчивается поддержка .NET 8?»</summary>
<p>Релизы выходят каждый ноябрь; чётные версии — <strong>LTS</strong> на три года, нечётные — <strong>STS</strong>, которым с .NET 9 продлили поддержку с 18 до 24 месяцев. Отсюда: .NET 8 (C# 12) — LTS до ноября 2026; .NET 9 (C# 13) — STS, тоже до ноября 2026, в один день с .NET 8 — 10 ноября; .NET 10 (C# 14) — LTS до ноября 2028.</p>
<p>Значит, сейчас актуален вопрос миграции на .NET 10. Хороший ответ про то, как это делать: обновить <code>TargetFramework</code> и пакеты, прочитать breaking changes, разобрать новые предупреждения анализаторов, прогнать тесты и нагрузку, сравнить метрики GC, памяти и latency до и после — а не просто «поменяли цифру в csproj».</p>
</details>
<details><summary>«Что такое HybridCache и чем он лучше IMemoryCache?»</summary>
<p><code>HybridCache</code> (пакет <code>Microsoft.Extensions.Caching.Hybrid</code>, появился в эпоху .NET 9) — двухуровневый кеш: быстрый уровень в памяти процесса плюс распределённый второй уровень, например Redis. Главное его отличие — <strong>защита от cache stampede</strong>: при промахе фабрика для одного ключа выполняется один раз, а остальные одновременные запросы ждут её результата. Координация действует в пределах одного экземпляра <code>HybridCache</code>: разные инстансы сервиса за общим Redis всё равно сходят в базу каждый сам.</p>
<p>Ни <code>IMemoryCache.GetOrCreate</code>, ни <code>ConcurrentDictionary.GetOrAdd</code> этого не гарантируют — под нагрузкой на холодном старте сто запросов за одним ключом дают сто походов в базу. С <code>IDistributedCache</code> вручную приходилось ещё и самим сериализовать значения и склеивать два уровня. Поэтому на собеседовании формулирую так: «<code>HybridCache</code> закрыл stampede на холодном старте и убрал самописную обвязку вокруг Redis». Если распределённый кеш не зарегистрирован, он работает как кеш в памяти, и второй уровень можно добавить позже без изменения кода.</p>
</details>` }
  ],
  questions: [
    { id: `dotnet-001`, chapter: `types`, type: 'choice', q: `<p>Что выведет код?</p>
<pre><code>int i = 5;
object o = i;
i = 10;
object p = o;
Console.WriteLine($"{o} {p} {o == p} {o.Equals(10)}");</code></pre>`, options: [`<code>10 10 True True</code>`, `<code>5 5 True False</code>`, `<code>5 5 False False</code>`, `<code>10 5 False False</code>`], answer: 1, explain: `<p>При упаковке в куче создаётся объект с <strong>копией</strong> значения 5, поэтому последующее <code>i = 10</code> его не трогает. <code>p = o</code> копирует ссылку, а не значение, так что <code>o == p</code> для двух переменных типа <code>object</code> — сравнение ссылок, и оно <code>True</code>. <code>o.Equals(10)</code> сравнивает упакованные 5 и 10 — <code>False</code>.</p>
<p>Соблазнительный вариант «10 10» исходит из представления, что <code>object o</code> «смотрит» на переменную <code>i</code>. Это не так: упаковка — это копирование значения в новый объект.</p>` },
    { id: `dotnet-002`, chapter: `types`, type: 'choice', q: `<p>Что выведет код?</p>
<pre><code>string a = "hello";
string b = "hel" + "lo";
string c = "hel";
string d = c + "lo";
Console.WriteLine(ReferenceEquals(a, b));
Console.WriteLine(ReferenceEquals(a, d));
Console.WriteLine(a == d);</code></pre>`, options: [`<code>True True True</code>`, `<code>False False True</code>`, `<code>True False True</code>`, `<code>True False False</code>`], answer: 2, explain: `<p><code>"hel" + "lo"</code> — константное выражение, компилятор складывает его в литерал <code>"hello"</code>, а одинаковые литералы интернированы: <code>a</code> и <code>b</code> — один объект. <code>c</code> — обычная (не <code>const</code>) переменная, поэтому <code>c + "lo"</code> вычисляется в рантайме через <code>string.Concat</code> и даёт <strong>новый</strong> объект — ссылки разные. Оператор <code>==</code> у строк сравнивает содержимое, поэтому третья строка — <code>True</code>.</p>
<p>Вариант «True True True» предполагает, что рантайм интернирует результат конкатенации автоматически, — этого не происходит; нужно явно вызвать <code>string.Intern</code>.</p>` },
    { id: `dotnet-003`, chapter: `types`, type: 'choice', q: `<p>Что выведет код?</p>
<pre><code>struct Counter
{
    public int Value;
    public void Increment() =&gt; Value++;
}

class Holder
{
    private readonly Counter _c = new();
    public int Bump()
    {
        _c.Increment();
        _c.Increment();
        return _c.Value;
    }
}

Console.WriteLine(new Holder().Bump());</code></pre>`, options: [`<code>0</code>`, `<code>2</code>`, `<code>1</code>`, `Ошибка компиляции: у <code>readonly</code>-поля нельзя вызывать методы`], answer: 0, explain: `<p>Поле <code>readonly</code>, а <code>Counter</code> — не <code>readonly struct</code>, и компилятор не знает, изменяет ли <code>Increment</code> состояние. Чтобы гарантировать неизменность поля, он вызывает метод на <strong>защитной копии</strong> (defensive copy). Каждый вызов увеличивает свою временную копию, само поле остаётся нулевым.</p>
<p>Ошибки компиляции нет — это и делает ловушку опасной. Лечится объявлением <code>readonly struct</code> (тогда <code>Value++</code> внутри не скомпилируется, и ошибка станет явной) или отказом от мутабельных структур.</p>` },
    { id: `dotnet-004`, chapter: `types`, type: 'choice', q: `<p>Что выведет код?</p>
<pre><code>record Order(int Id, List&lt;string&gt; Tags);

var a = new Order(1, new List&lt;string&gt; { "x" });
var b = new Order(1, new List&lt;string&gt; { "x" });
var c = a with { };
Console.WriteLine($"{a == b} {a == c} {ReferenceEquals(a.Tags, c.Tags)}");</code></pre>`, options: [`<code>True True False</code>`, `<code>True True True</code>`, `<code>False False True</code>`, `<code>False True True</code>`], answer: 3, explain: `<p>Сгенерированное равенство record сравнивает поля через <code>EqualityComparer&lt;T&gt;.Default</code>, а для <code>List&lt;string&gt;</code> это <strong>сравнение ссылок</strong>. У <code>a</code> и <code>b</code> разные объекты списков — записи не равны. <code>with</code> делает <strong>поверхностную</strong> копию: <code>c</code> получает ту же ссылку на список, поэтому <code>a == c</code> и <code>ReferenceEquals</code> — <code>True</code>.</p>
<p>Вариант с <code>True</code> в начале — частая ошибка: «records сравниваются по значению» верно только для самих полей, а не для содержимого коллекций внутри них.</p>` },
    { id: `dotnet-005`, chapter: `types`, type: 'open', q: `«Где хранятся value types?» Ответьте так, как ответил бы senior.`, answer: `<ul><li>Спецификация описывает <strong>семантику</strong>, а не место: value type копируется при присваивании и не имеет identity, reference type передаётся по ссылке. Место хранения — деталь реализации.</li><li>Точное правило: значение хранится <strong>там же, где его контейнер</strong>. Локальная переменная — в кадре стека или в регистре; поле класса и элемент массива — внутри объекта в куче; упакованное значение — в куче.</li><li>Локальная переменная попадает в кучу, если её <strong>захватила лямбда</strong> (поле display class) или она живёт через <code>await</code>/<code>yield</code> (поле state machine).</li><li>Обратное тоже не абсолютно: начиная с .NET 9–10 JIT может разместить на стеке небольшой объект, который не покидает метод (escape analysis).</li><li>Практический смысл: value types выгодны не «быстрым стеком», а <strong>отсутствием аллокации и работы для GC</strong>, отсутствием косвенного обращения и плотным размещением в массивах — <code>int[]</code> из миллиона элементов это один объект.</li></ul>` },
    { id: `dotnet-006`, chapter: `types`, type: 'open', q: `Сформулируйте контракт <code>Equals</code>/<code>GetHashCode</code>. Что произойдёт, если изменить поле объекта, участвующее в хэше, пока объект лежит ключом в <code>Dictionary</code>?`, answer: `<ul><li>Равные объекты обязаны иметь <strong>равные хэш-коды</strong>; обратное не требуется — коллизии допустимы.</li><li><code>Equals</code> рефлексивен, симметричен, транзитивен, стабилен (без изменения объекта результат тот же), <code>x.Equals(null)</code> — <code>false</code>.</li><li>Переопределяя <code>Equals</code>, переопределяют <code>GetHashCode</code>, обычно реализуют <code>IEquatable&lt;T&gt;</code> (для struct — чтобы не было упаковки) и операторы <code>==</code>/<code>!=</code>.</li><li>Хэш-код не должен меняться, пока объект лежит в хэш-коллекции, поэтому его строят по <strong>неизменяемым</strong> полям (<code>HashCode.Combine</code>).</li><li>Если мутировать ключ: запись остаётся в бакете <strong>старого</strong> хэша. Поиск по самому объекту идёт в бакет нового хэша и ничего не находит; поиск по «старому» значению находит запись, но <code>Equals</code> уже не совпадает. Объект «потерян»: <code>ContainsKey</code> — <code>false</code>, <code>Remove</code> не работает, а запись занимает память. Решение — неизменяемые ключи (<code>readonly record struct</code>, <code>record</code> с <code>init</code>-свойствами).</li></ul>` },
    { id: `dotnet-007`, chapter: `gc`, type: 'choice', q: `Какие объекты попадают в Large Object Heap?`, options: [`Любой массив длиннее 1000 элементов`, `Объекты размером от 1 МБ`, `Объекты размером от 85 000 байт (порог можно настроить через <code>GCLOHThreshold</code>)`, `Объекты, пережившие две сборки мусора`], answer: 2, explain: `<p>Порог LOH — 85 000 байт по размеру объекта. На практике туда попадают большие массивы и строки. LOH собирается вместе с gen2 и по умолчанию не уплотняется, поэтому частые временные большие буферы ведут к full GC и фрагментации — их берут из <code>ArrayPool&lt;T&gt;</code>.</p>
<p>«Пережившие две сборки» описывает gen2, а не LOH: поколение определяется возрастом объекта, LOH — размером. «Массив длиннее 1000 элементов» — смесь с устаревшей частной деталью про массивы <code>double</code> в 32-битном рантайме, а не общее правило.</p>` },
    { id: `dotnet-008`, chapter: `gc`, type: 'choice', q: `На объект с финализатором больше нет ссылок, <code>Dispose</code> не вызывали, <code>GC.SuppressFinalize</code> тоже. Что произойдёт?`, options: [`Объект освободится на ближайшей сборке, финализатор вызовется синхронно в потоке, который запустил GC`, `Объект переживёт как минимум ещё одну сборку: GC переместит его в очередь f-reachable, финализатор выполнит отдельный поток финализации, память освободится на одной из следующих сборок`, `Финализатор гарантированно вызовется, самое позднее — при завершении процесса`, `Если класс реализует <code>IDisposable</code>, GC вызовет <code>Dispose</code> вместо финализатора`], answer: 1, explain: `<p>Объект с финализатором регистрируется в finalization queue при создании. Став недостижимым, он попадает в очередь f-reachable, которая сама является корнем, — объект и всё, на что он ссылается, переживают сборку и продвигаются в старшее поколение. Финализатор выполняет единственный finalizer thread, и только следующая сборка освобождает память.</p>
<p>Вариант про завершение процесса неверен для .NET Core и новее: финализаторы при выходе процесса не запускаются. GC вообще ничего не знает об <code>IDisposable</code> — это обычный интерфейс.</p>` },
    { id: `dotnet-009`, chapter: `gc`, type: 'choice', q: `Какое утверждение о режимах GC верно?`, options: [`Server GC использует одну кучу, но несколько потоков для маркировки`, `Server GC включается автоматически на любой машине, где больше четырёх ядер`, `Server GC всегда потребляет меньше памяти, чем Workstation GC`, `ASP.NET Core по умолчанию использует Server GC: несколько куч и выделенные потоки GC; с .NET 9 для него по умолчанию включён DATAS, подстраивающий число куч под нагрузку`], answer: 3, explain: `<p>Server GC создаёт кучу и поток GC на каждое логическое ядро (с DATAS — адаптивно меньше), у него большие бюджеты gen0 и выше пропускная способность — поэтому его выбирает ASP.NET Core. Платой исторически была большая память, особенно в контейнерах; DATAS (появился в .NET 8, включён по умолчанию с .NET 9) решает именно это.</p>
<p>Режим выбирается конфигурацией приложения (шаблон ASP.NET Core включает Server GC), а не числом ядер. И Server GC обычно потребляет <strong>больше</strong> памяти, а не меньше.</p>` },
    { id: `dotnet-010`, chapter: `gc`, type: 'open', q: `Когда нужен полный Dispose pattern с <code>Dispose(bool disposing)</code> и финализатором, а когда достаточно простого <code>Dispose()</code>?`, answer: `<ul><li><strong>Полный паттерн</strong> нужен, только если класс <strong>напрямую</strong> владеет неуправляемым ресурсом (сырой <code>IntPtr</code>, хэндл ОС) и при этом <strong>не sealed</strong> (наследники должны уметь освободить своё).</li><li><code>Dispose()</code> вызывает <code>Dispose(true)</code> и <code>GC.SuppressFinalize(this)</code>; финализатор вызывает <code>Dispose(false)</code>. При <code>disposing == true</code> освобождаются и управляемые <code>IDisposable</code>-поля; при <code>false</code> (из финализатора) их трогать нельзя — они могли уже быть финализированы. Неуправляемое освобождается в обоих случаях. Метод идемпотентен.</li><li><strong>На практике</strong> сырой хэндл оборачивают в <code>SafeHandle</code>: у него критический финализатор и подсчёт ссылок, защищающий от закрытия хэндла посреди P/Invoke и от handle recycling. Тогда собственный финализатор не нужен.</li><li>Класс, владеющий <strong>только управляемыми</strong> disposable-полями (соединение, <code>HttpClient</code>, <code>Stream</code>), реализует простой <code>Dispose()</code>, лучше в <code>sealed</code>-классе; финализатор ему вреден — он только продлевает жизнь объекта.</li><li>Если освобождение требует I/O (сбросить буфер, закрыть соединение) — <code>IAsyncDisposable</code> и <code>await using</code>.</li></ul>` },
    { id: `dotnet-011`, chapter: `gc`, type: 'open', q: `Бывают ли утечки памяти в .NET, если есть GC? Приведите примеры и расскажите, как их искать.`, answer: `<p>Да: GC собирает только <strong>недостижимое</strong>, а утечка — это ненужный, но достижимый объект.</p>
<ul><li><strong>События</strong>: долгоживущий издатель держит делегат, делегат держит подписчика через <code>Target</code>. Отписка в <code>Dispose</code> или weak event.</li><li><strong>Статические кеши и словари</strong> без вытеснения — растут вечно. Нужен <code>MemoryCache</code> с <code>SizeLimit</code> и TTL.</li><li><strong>Замыкания</strong>, сохранённые в долгоживущем месте (колбэк, таймер), захватывающие <code>this</code> или большой буфер.</li><li><strong><code>CancellationToken.Register</code></strong> и linked token sources на долгоживущем токене без <code>Dispose</code> — регистрации копятся.</li><li><strong>Таймеры</strong>, которые не остановили, держат колбэк и его состояние.</li><li><strong>Captive dependency</strong>: синглтон держит scoped-сервис; transient <code>IDisposable</code> из корневого провайдера хранится контейнером до конца приложения.</li><li>Неограниченные очереди и каналы при медленном потребителе.</li></ul>
<p>Поиск: метрики размера куч и gen2 в <code>dotnet-counters</code>, два снимка кучи с интервалом (<code>dotnet-gcdump</code>, dotMemory), сравнение растущих типов и анализ <strong>пути удержания до корня</strong> (что именно держит объект).</p>` },
    { id: `dotnet-012`, chapter: `gc`, type: 'open', q: `Зачем GC поколения и как сборка gen0 обходится без сканирования gen2?`, answer: `<ul><li>Поколенческая гипотеза: большинство объектов умирает молодыми. Собирая отдельно молодые объекты, GC выполняет мало работы за сборку — живых среди них немного, и уплотнять приходится мало.</li><li>Проблема: на молодой объект может ссылаться старый объект из gen2, и его тоже надо считать корнем. Сканировать весь gen2 на каждой сборке gen0 — потерять весь выигрыш.</li><li>Решение — <strong>card table</strong>: старшие поколения разбиты на участки, у каждого бит «здесь могла появиться ссылка на молодой объект». Бит ставит <strong>write barrier</strong> — код, который JIT вставляет в каждую запись ссылки в поле объекта.</li><li>При сборке gen0 GC сканирует только «грязные» карты и считает найденные ссылки дополнительными корнями.</li><li>Следствия: запись ссылки чуть дороже записи числа; большая долгоживущая структура, в которую постоянно пишут свежие объекты, удорожает эфемерные сборки; объекты, живущие «средне» (mid-life crisis), доезжают до gen2 и провоцируют дорогие full GC.</li></ul>` },
    { id: `dotnet-013`, chapter: `span`, type: 'choice', q: `Что из перечисленного разрешено делать с <code>Span&lt;byte&gt;</code>?`, options: [`Сохранить его в приватное поле класса, чтобы переиспользовать буфер между вызовами`, `Захватить его в лямбду, переданную в <code>Task.Run</code>`, `Создать его как локальную переменную в синхронном методе и передать в другой синхронный метод`, `Объявить его до <code>await</code> и прочитать после <code>await</code> в async-методе`], answer: 2, explain: `<p><code>Span&lt;T&gt;</code> — <code>ref struct</code> и может жить только на стеке: как локальная переменная, параметр или возвращаемое значение синхронных методов. Это и есть разрешённый сценарий.</p>
<p>Поле класса, захват в лямбду (поле замыкания) и переживание <code>await</code> (поле state machine) — всё это означает перенос в кучу, а Span может указывать на стековую память и внутрь объектов. Компилятор такие варианты запрещает. Для хранения и асинхронного кода есть <code>Memory&lt;T&gt;</code>.</p>` },
    { id: `dotnet-014`, chapter: `span`, type: 'choice', q: `<code>var buf = ArrayPool&lt;byte&gt;.Shared.Rent(1000);</code> — что верно о <code>buf</code>?`, options: [`Его длина не меньше 1000 и может быть больше; содержимое может остаться от прошлого использования`, `Его длина ровно 1000, массив заполнен нулями`, `Его длина ровно 1000, но содержимое не обнулено`, `Массив выделен в стеке и будет освобождён при выходе из метода`], answer: 0, explain: `<p>Пул округляет размеры до своих корзин, поэтому <code>Rent</code> возвращает массив <strong>не меньше</strong> запрошенного — работать нужно с первыми <code>n</code> элементами, а не с <code>Length</code>. Массив не обнуляется при выдаче (обнулить при возврате можно <code>Return(buf, clearArray: true)</code>).</p>
<p>Самый коварный неверный вариант — «ровно 1000»: код, который полагается на <code>buf.Length</code>, обработает лишние байты с чужими данными. Массивы из пула — обычные массивы в куче; стек — это <code>stackalloc</code>.</p>` },
    { id: `dotnet-015`, chapter: `span`, type: 'open', q: `Чем <code>Memory&lt;T&gt;</code> отличается от <code>Span&lt;T&gt;</code>, и как выбрать тип параметра метода?`, answer: `<ul><li><code>Span&lt;T&gt;</code> — <code>ref struct</code> (ссылка + длина): живёт только на стеке, может указывать на массив, строку, <code>stackalloc</code> и нативную память, срезы и индексация максимально быстрые.</li><li><code>Memory&lt;T&gt;</code> — обычная структура (ссылка на владельца + смещение + длина): её можно хранить в полях, коллекциях, передавать через <code>await</code>. Не может указывать на стековую память. Для работы с данными берут <code>.Span</code>.</li><li>Правило: <strong>синхронный</strong> метод принимает <code>ReadOnlySpan&lt;T&gt;</code>/<code>Span&lt;T&gt;</code>, <strong>асинхронный</strong> или сохраняющий данные — <code>ReadOnlyMemory&lt;T&gt;</code>/<code>Memory&lt;T&gt;</code>.</li><li>Предпочитать <code>ReadOnly</code>-варианты, если метод не пишет: в <code>ReadOnlySpan&lt;char&gt;</code> можно передать и <code>string</code>, и <code>char[]</code>.</li><li>Владение памятью из пула выражает <code>IMemoryOwner&lt;T&gt;</code> (<code>MemoryPool&lt;T&gt;</code>): кто держит owner, тот вызывает <code>Dispose</code>.</li></ul>` },
    { id: `dotnet-016`, chapter: `span`, type: 'open', q: `Почему у <code>ref struct</code> (например, <code>Span&lt;T&gt;</code>) столько ограничений: нельзя в поле класса, в лямбду, через <code>await</code>, в generic-аргумент?`, answer: `<ul><li>Span может указывать на <strong>стековую память</strong> (<code>stackalloc</code>) или в середину кадра. Если бы он попал в кучу (поле объекта, замыкание, state machine async-метода, упаковка), он мог бы пережить кадр, на который указывает, — висячая ссылка и порча памяти.</li><li>Span содержит <strong>внутреннюю управляемую ссылку</strong> (byref) на середину объекта. GC умеет отслеживать такие ссылки на стеке, но не в полях объектов кучи.</li><li>Span — две величины (ссылка и длина). В общей памяти конкурентная запись могла бы его «порвать» (tearing), и проверка границ перестала бы гарантировать безопасность.</li><li>Generic-аргумент запрещён, потому что generic-код мог бы упаковать T или сохранить его в поле. C# 13 позволил это там, где параметр помечен <code>allows ref struct</code>, — компилятор тогда проверяет, что generic-код соблюдает правила.</li><li>Все проверки статические (ref safety rules, <code>scoped</code>), поэтому ошибки видны при компиляции.</li></ul>` },
    { id: `dotnet-017`, chapter: `span`, type: 'open', q: `Какие опасности у <code>stackalloc</code> и как безопасно выделить временный буфер переменного размера?`, answer: `<ul><li>Стек потока ограничен (порядка мегабайта), а <code>StackOverflowException</code> <strong>не перехватывается</strong> — процесс падает. Поэтому только небольшие размеры и никогда не размер, пришедший извне без верхней границы.</li><li>Память освобождается при выходе из <strong>метода</strong>, а не из блока: <code>stackalloc</code> в цикле копит память на каждой итерации.</li><li>Буфер обнуляется (это стоит времени); <code>[SkipLocalsInit]</code> убирает обнуление, но тогда в буфере мусор.</li><li>Стандартный приём: если длина не больше порога (например, 256 байт) — <code>stackalloc</code>, иначе — <code>ArrayPool&lt;byte&gt;.Shared.Rent</code>, затем срез до нужной длины и <code>Return</code> в <code>finally</code>. Оба варианта приводятся к одному <code>Span&lt;byte&gt;</code>, и остальной код от выбора не зависит.</li></ul>` },
    { id: `dotnet-018`, chapter: `generics`, type: 'choice', q: `<p>Что выведет код?</p>
<pre><code>var actions = new List&lt;Action&gt;();
for (int i = 0; i &lt; 3; i++)
    actions.Add(() =&gt; Console.Write(i));
foreach (var a in actions) a();</code></pre>`, options: [`<code>012</code>`, `<code>333</code>`, `<code>000</code>`, `Ошибка компиляции: нельзя захватывать переменную цикла`], answer: 1, explain: `<p>Лямбда захватывает <strong>переменную</strong>, а не её значение. Переменная <code>i</code>, объявленная в заголовке <code>for</code>, одна на весь цикл; все три лямбды ссылаются на одно поле одного замыкания. Когда их вызывают, цикл уже закончился и <code>i == 3</code>.</p>
<p>Ответ <code>012</code> был бы верен для <code>foreach</code> (с C# 5 переменная итерации новая на каждом проходе) или если скопировать значение внутри тела: <code>int copy = i;</code>.</p>` },
    { id: `dotnet-019`, chapter: `generics`, type: 'choice', q: `Какая строка компилируется?`, options: [`<code>List&lt;object&gt; list = new List&lt;string&gt;();</code>`, `<code>IEnumerable&lt;object&gt; nums = new List&lt;int&gt;();</code>`, `<code>Action&lt;string&gt; a = s =&gt; {}; Action&lt;object&gt; b = a;</code>`, `<code>IEnumerable&lt;object&gt; items = new List&lt;string&gt;();</code>`], answer: 3, explain: `<p><code>IEnumerable&lt;out T&gt;</code> ковариантен, и для ссылочных типов последовательность строк можно читать как последовательность объектов.</p>
<p><code>List&lt;T&gt;</code> — класс, а у классов вариантности нет. Вариантность не работает для value types: <code>int</code> и <code>object</code> по-разному представлены в памяти, нужна была бы упаковка каждого элемента. <code>Action&lt;in T&gt;</code> контравариантен — присвоить можно в обратную сторону: <code>Action&lt;object&gt;</code> в <code>Action&lt;string&gt;</code>, но не наоборот.</p>` },
    { id: `dotnet-020`, chapter: `generics`, type: 'choice', q: `Какое утверждение о машинном коде generic-типов в .NET верно?`, options: [`<code>List&lt;string&gt;</code> и <code>List&lt;Order&gt;</code> используют общий машинный код, а <code>List&lt;int&gt;</code> и <code>List&lt;long&gt;</code> получают отдельные специализированные копии`, `JIT создаёт отдельную копию кода для каждого закрытого типа, включая ссылочные`, `Все инстанциации используют общий код, а значения упаковываются, как в Java`, `Value types используют общий код, а reference types специализируются`], answer: 0, explain: `<p>Все ссылки одинакового размера и одинаково видны GC, поэтому для ссылочных аргументов JIT компилирует один вариант (для условного <code>System.__Canon</code>) и получает конкретный тип через runtime lookup. Для value types размер и способ сравнения различаются, поэтому каждая инстанциация специализирована — без упаковки и с полноценными оптимизациями.</p>
<p>«Как в Java» — это type erasure, которого в .NET нет: generics реифицированы.</p>` },
    { id: `dotnet-021`, chapter: `generics`, type: 'choice', q: `Метод вызывается миллион раз. Для какой лямбды компилятор создаст делегат один раз и будет переиспользовать его между вызовами метода?`, options: [`<code>items.Where(x =&gt; x &gt; threshold)</code>, где <code>threshold</code> — локальная переменная метода`, `<code>items.Where(x =&gt; x &gt; this.limit)</code>`, `<code>items.Where(static x =&gt; x &gt; 100)</code>`, `Ни для одной: любая лямбда создаёт новый делегат на каждый вызов`], answer: 2, explain: `<p>Лямбда без захвата кешируется компилятором в статическом поле, а модификатор <code>static</code> гарантирует отсутствие захвата на уровне компиляции.</p>
<p>Захват локальной переменной требует экземпляра display class и нового делегата на каждый вызов метода. Захват <code>this</code> обходится без display class, но делегат привязан к конкретному экземпляру и тоже создаётся каждый раз. (Сам <code>Where</code> в любом случае выделяет объект-итератор — вопрос только о делегате.)</p>` },
    { id: `dotnet-022`, chapter: `generics`, type: 'open', q: `Как компилятор реализует замыкания и как уменьшить аллокации, связанные с лямбдами?`, answer: `<ul><li>Захваченные локальные переменные переносятся в поля сгенерированного класса (display class), тело лямбды становится его методом; внешний код и лямбда работают с одним полем.</li><li>Экземпляр display class создаётся при <strong>входе в область видимости</strong> захваченной переменной — даже если ветка с лямбдой не выполнится. Редкую ветку с лямбдой стоит вынести в отдельный метод.</li><li>Без захвата делегат кешируется в статическом поле; с захватом <code>this</code> — новый делегат на каждое создание; с захватом локальных — замыкание плюс делегат.</li><li>Инструменты: <code>static</code>-лямбды (C# 9) — запрет захвата; перегрузки с явным состоянием (<code>GetOrAdd(key, static (k, arg) =&gt; ..., arg)</code>, <code>string.Create(len, state, ...)</code>); <strong>локальные функции</strong>, вызываемые напрямую, получают захваченные переменные через структуру по ссылке — без аллокаций; кеширование делегата в поле; с C# 11 method group на статический метод кешируется.</li><li>Проверка — профилировщик аллокаций или <code>[MemoryDiagnoser]</code>; оптимизировать стоит только горячие пути.</li></ul>` },
    { id: `dotnet-023`, chapter: `generics`, type: 'open', q: `Что происходит при вызове multicast-делегата, если обработчики возвращают значения или бросают исключения? Чем <code>event</code> отличается от публичного поля-делегата?`, answer: `<ul><li><code>+=</code> создаёт новый неизменяемый делегат со списком вызовов; при вызове методы выполняются <strong>по порядку</strong>, синхронно.</li><li>Возвращается результат <strong>последнего</strong> обработчика, остальные теряются.</li><li>Исключение в одном обработчике <strong>прерывает</strong> цепочку: следующие не вызываются. Чтобы вызвать всех независимо или собрать результаты — <code>GetInvocationList()</code> и цикл с <code>try</code>/<code>catch</code>.</li><li><code>event</code> ограничивает доступ: снаружи только <code>+=</code>/<code>-=</code>, а вызвать или присвоить (<code>= null</code>, обнулив всех подписчиков) может только владелец. Field-like event генерирует потокобезопасные <code>add</code>/<code>remove</code> через <code>Interlocked.CompareExchange</code>.</li><li>Вызывать через <code>Handler?.Invoke(this, e)</code>: поле читается один раз, нет гонки с отпиской.</li><li>Делегат на метод экземпляра держит <code>Target</code> — неотписанный подписчик долгоживущего издателя утекает.</li></ul>` },
    { id: `dotnet-024`, chapter: `collections`, type: 'choice', q: `<p>Что можно сказать о <code>calls</code> и словаре после выполнения кода?</p>
<pre><code>var cd = new ConcurrentDictionary&lt;int, string&gt;();
int calls = 0;
Parallel.For(0, 8, _ =&gt; cd.GetOrAdd(1, k =&gt;
{
    Interlocked.Increment(ref calls);
    Thread.Sleep(100);
    return "v" + k;
}));</code></pre>`, options: [`<code>calls</code> всегда равно 1: <code>GetOrAdd</code> выполняет фабрику под блокировкой бакета`, `<code>calls</code> всегда равно 8, а в словаре 8 значений`, `<code>calls</code> может быть от 1 до 8, но в словаре одно значение, и все вызовы <code>GetOrAdd</code> вернули один и тот же объект`, `Будет <code>InvalidOperationException</code> из-за параллельного вызова фабрики`], answer: 2, explain: `<p>Фабрика <code>GetOrAdd</code> выполняется <strong>вне блокировки</strong>: несколько потоков, одновременно не нашедших ключ, выполнят её параллельно. Затем добавление идёт под замком, выигрывает одно значение, а проигравшие получают значение победителя. Словарь остаётся согласованным, но работа (и, возможно, ресурсы) потрачены зря.</p>
<p>Вариант «всегда 1» — именно то, что ожидают от метода с таким названием, и именно поэтому это ловушка. Если фабрика дорогая или создаёт <code>IDisposable</code>, хранят <code>Lazy&lt;T&gt;</code> с <code>ExecutionAndPublication</code>.</p>` },
    { id: `dotnet-025`, chapter: `collections`, type: 'choice', q: `<p>Что выведет код?</p>
<pre><code>class Key
{
    public int Id { get; set; }
    public override bool Equals(object? o) =&gt; o is Key k &amp;&amp; k.Id == Id;
    public override int GetHashCode() =&gt; Id;
}

var key = new Key { Id = 1 };
var map = new Dictionary&lt;Key, string&gt; { [key] = "first" };
key.Id = 2;
Console.WriteLine(map.ContainsKey(key));
Console.WriteLine(map.ContainsKey(new Key { Id = 1 }));</code></pre>`, options: [`<code>True True</code>`, `<code>False True</code>`, `<code>True False</code>`, `<code>False False</code>`], answer: 3, explain: `<p>Запись лежит в бакете хэша 1 и хранит сохранённый хэш 1. Поиск по <code>key</code> теперь считает хэш 2 — сохранённый хэш не совпадает, запись не найдена. Поиск по новому ключу с <code>Id = 1</code> находит запись по хэшу, но <code>Equals</code> сравнивает 1 с текущим <code>Id</code> хранимого ключа, равным 2, — тоже мимо. Запись есть в словаре, но недоступна ни одним способом.</p>
<p>Вариант «False True» предполагает, что словарь сравнивает со «старым» состоянием ключа, — но словарь хранит ссылку на тот же объект, а не его копию.</p>` },
    { id: `dotnet-026`, chapter: `collections`, type: 'choice', q: `Нужно добавить миллион ключей в <strong>случайном</strong> порядке, а затем часто искать по ключу и перебирать по возрастанию. Что верно?`, options: [`<code>SortedList</code> быстрее на вставках: массивы лучше ложатся в кеш процессора`, `Лучше <code>SortedDictionary</code>: вставка O(log n), а у <code>SortedList</code> вставка в середину сдвигает элементы массива — O(n) на вставку, O(n²) суммарно`, `Обе коллекции — красно-чёрные деревья, разница только в API`, `Обе коллекции — хэш-таблицы, поиск в них O(1)`], answer: 1, explain: `<p><code>SortedDictionary</code> — красно-чёрное дерево, все операции O(log n). <code>SortedList</code> — два отсортированных массива: поиск бинарный O(log n), но вставка в произвольное место сдвигает в среднем половину элементов.</p>
<p>Довод про кеш процессора реален, и для <strong>уже отсортированных</strong> данных (вставка в конец) или однократного построения с последующим чтением <code>SortedList</code> действительно может выиграть. Но при случайном порядке O(n²) на миллионе элементов перевешивает любую локальность.</p>` },
    { id: `dotnet-027`, chapter: `collections`, type: 'open', q: `Расскажите, как устроен <code>Dictionary&lt;TKey, TValue&gt;</code> внутри: поиск, коллизии, рост.`, answer: `<ul><li>Два массива: <code>buckets</code> (для каждого бакета — индекс первой записи цепочки) и плотный <code>entries</code> со структурами <code>{ hashCode, next, key, value }</code>. Коллизии разрешаются <strong>цепочками</strong>, связанными через индекс <code>next</code> внутри массива записей, а не через отдельные узлы-объекты.</li><li>Поиск: хэш ключа через comparer → номер бакета (остаток от деления на простое число) → проход по цепочке, сначала сравнение сохранённых хэшей, затем <code>Equals</code>.</li><li>Удалённые записи попадают в free list и переиспользуются при добавлении.</li><li>Рост: когда записи кончились, размер становится ближайшим простым не меньше удвоенного, все записи перераспределяются по бакетам; хэши не пересчитываются — они сохранены. Амортизированно добавление O(1). Если размер известен — передать capacity.</li><li>Плохой <code>GetHashCode</code> (константа, непереопределённый у struct, учитывающий одно поле) скапливает ключи в немногих цепочках — O(n). Хэш строк рандомизирован на процесс (защита от HashDoS), поэтому его нельзя сохранять.</li><li>Не потокобезопасен для записи; порядок перечисления не гарантирован; ключи мутировать нельзя.</li></ul>` },
    { id: `dotnet-028`, chapter: `collections`, type: 'open', q: `Как растёт <code>List&lt;T&gt;</code> и почему стоит задавать capacity?`, answer: `<ul><li>Внутри массив <code>T[]</code> и счётчик. Пустой список массива не имеет; первое добавление выделяет массив на 4 элемента, затем при заполнении создаётся массив <strong>вдвое больше</strong> и элементы копируются.</li><li><code>Add</code> амортизированно O(1), но каждое удвоение — новая аллокация и копирование, а старый массив становится мусором. При наполнении миллиона элементов это около двадцати промежуточных массивов, крупные из которых попадают в LOH.</li><li><code>new List&lt;T&gt;(n)</code> или <code>EnsureCapacity(n)</code> выделяет массив один раз. После наполнения можно отдать лишнее через <code>TrimExcess</code>.</li><li>Вставка и удаление в начале — O(n) из-за сдвига; <code>Contains</code>/<code>Remove(item)</code> — линейный поиск.</li><li>Изменение списка во время <code>foreach</code> бросает <code>InvalidOperationException</code>: enumerator сверяет поле <code>_version</code>.</li></ul>` },
    { id: `dotnet-029`, chapter: `collections`, type: 'open', q: `Чем отличаются <code>ReadOnlyCollection&lt;T&gt;</code>, <code>ImmutableList&lt;T&gt;</code>, <code>ImmutableArray&lt;T&gt;</code> и <code>FrozenDictionary&lt;TKey, TValue&gt;</code>? Когда что выбрать?`, answer: `<ul><li><strong><code>ReadOnlyCollection&lt;T&gt;</code> / <code>IReadOnlyList&lt;T&gt;</code></strong> — только обёртка или интерфейс: запрещает изменение <strong>через эту ссылку</strong>, но владелец исходного списка может его менять, и изменения видны. Подходит для инкапсуляции в API.</li><li><strong><code>ImmutableList&lt;T&gt;</code></strong> — сбалансированное дерево: «изменение» возвращает новую коллекцию за O(log n) с переиспользованием структуры. Хорош для снимков состояния, которые часто «меняют» и безопасно читают из многих потоков. Чтение медленнее массива.</li><li><strong><code>ImmutableArray&lt;T&gt;</code></strong> — структура над массивом: чтение как у массива, но любое изменение копирует всё за O(n). Для небольших редко меняющихся данных. Ловушка — <code>default(ImmutableArray&lt;T&gt;)</code>.</li><li><strong><code>FrozenDictionary</code>/<code>FrozenSet</code></strong> (.NET 8) — дорогое создание с анализом ключей, самое быстрое чтение. Для справочников, построенных один раз при старте: маппинги, конфигурация, коды. При обновлении создают новый экземпляр и атомарно подменяют ссылку.</li></ul>` },
    { id: `dotnet-030`, chapter: `linq`, type: 'choice', q: `<p>Что выведет код?</p>
<pre><code>var numbers = new List&lt;int&gt; { 1, 2, 3 };
int min = 1;
var query = numbers.Where(n =&gt; n &gt; min);
min = 2;
numbers.Add(4);
Console.WriteLine(string.Join(",", query));</code></pre>`, options: [`<code>2,3</code>`, `<code>2,3,4</code>`, `<code>3,4</code>`, `<code>3</code>`], answer: 2, explain: `<p><code>Where</code> ничего не вычисляет при вызове — запрос выполняется, когда <code>string.Join</code> его перечисляет. К этому моменту в списке четыре элемента, а лямбда читает <strong>текущее</strong> значение захваченной переменной <code>min</code>, равное 2. Остаются 3 и 4.</p>
<p><code>2,3,4</code> учитывает добавленный элемент, но забывает, что захвачена переменная, а не её значение на момент описания запроса.</p>` },
    { id: `dotnet-031`, chapter: `linq`, type: 'choice', q: `<p>Что выведет код?</p>
<pre><code>int calls = 0;
IEnumerable&lt;int&gt; Source()
{
    for (int i = 1; i &lt;= 3; i++) { calls++; yield return i; }
}

var q = Source().Where(x =&gt; x &gt; 0);
int count = q.Count();
int sum = q.Sum();
Console.WriteLine(calls);</code></pre>`, options: [`<code>3</code>`, `<code>6</code>`, `<code>0</code>`, `<code>9</code>`], answer: 1, explain: `<p><code>q</code> — не коллекция, а описание запроса. <code>Count()</code> перечисляет его полностью (три вызова тела цикла), <code>Sum()</code> перечисляет <strong>заново</strong> — ещё три. Это и есть множественное перечисление: с источником-запросом к базе или HTTP-вызовом работа была бы выполнена дважды.</p>
<p>Ответ 3 был бы верен, если бы результат материализовали один раз: <code>var list = q.ToList();</code>.</p>` },
    { id: `dotnet-032`, chapter: `linq`, type: 'choice', q: `Репозиторий объявлен как <code>public IEnumerable&lt;Order&gt; GetAll() =&gt; _db.Orders;</code> (EF Core). Что произойдёт при вызове <code>repo.GetAll().Where(o =&gt; o.Status == OrderStatus.Shipped).Take(10).ToList()</code>?`, options: [`В базу уйдёт запрос без <code>WHERE</code> и <code>LIMIT</code>: все строки загрузятся в память, фильтр и <code>Take</code> выполнятся на клиенте`, `EF Core переведёт <code>Where</code> и <code>Take</code> в SQL — тип возврата метода на это не влияет`, `Будет исключение: <code>IEnumerable</code> нельзя фильтровать после <code>DbSet</code>`, `EF Core выполнит запрос дважды — для <code>Where</code> и для <code>Take</code>`], answer: 0, explain: `<p>Выбор между <code>Enumerable.Where</code> и <code>Queryable.Where</code> делается <strong>на этапе компиляции</strong> по статическому типу. Статический тип здесь <code>IEnumerable&lt;Order&gt;</code>, поэтому вызывается LINQ to Objects с делегатом, а не с деревом выражения. EF Core получает запрос «всю таблицу» и перечисляет её, а фильтрация идёт в памяти.</p>
<p>Вариант «тип не влияет» — главное заблуждение: объект в рантайме действительно <code>IQueryable</code>, но выбор перегрузки extension-метода от рантайм-типа не зависит. Исправление — возвращать <code>IQueryable&lt;Order&gt;</code> или, лучше, методы с конкретными запросами.</p>` },
    { id: `dotnet-033`, chapter: `linq`, type: 'open', q: `Во что компилируется метод с <code>yield return</code>? Почему проверка аргумента в начале такого метода «не работает» и как это исправить?`, answer: `<ul><li>Компилятор генерирует класс, реализующий <code>IEnumerable&lt;T&gt;</code> и <code>IEnumerator&lt;T&gt;</code>: поле состояния, <code>Current</code>, параметры и локальные переменные как поля; тело переписано в <code>MoveNext()</code> со <code>switch</code> по состоянию, каждый <code>yield return</code> — точка выхода и последующего продолжения.</li><li>Тело <strong>не выполняется до первого <code>MoveNext</code></strong>. Поэтому <code>throw new ArgumentNullException</code> в начале сработает не при вызове метода, а при первом перечислении — возможно, совсем в другом месте программы.</li><li>Исправление: разделить на обычный метод, который проверяет аргументы и возвращает результат вложенного итератора (часто — локальной функции). Так устроены методы LINQ в BCL.</li><li><code>finally</code> и <code>using</code> внутри итератора выполняются в <code>Dispose()</code> перечислителя — <code>foreach</code> вызывает его и при <code>break</code>, ручной <code>GetEnumerator()</code> без <code>Dispose</code> оставит ресурсы открытыми.</li><li><code>yield return</code> нельзя внутри <code>try</code> с <code>catch</code> и внутри <code>finally</code>.</li></ul>` },
    { id: `dotnet-034`, chapter: `linq`, type: 'open', q: `В чём разница между <code>IEnumerable&lt;T&gt;</code> и <code>IQueryable&lt;T&gt;</code>? Что происходит с методом, который нельзя перевести в SQL?`, answer: `<ul><li><code>IEnumerable&lt;T&gt;</code>: операторы LINQ to Objects принимают <strong>делегаты</strong> (<code>Func&lt;T, bool&gt;</code>) и выполняются в памяти процесса.</li><li><code>IQueryable&lt;T&gt;</code>: операторы принимают <strong>деревья выражений</strong> (<code>Expression&lt;Func&lt;T, bool&gt;&gt;</code>) — код как данные. Провайдер (EF Core) обходит дерево и строит SQL; выполнение — в базе.</li><li>Одна и та же лямбда компилируется в делегат или в дерево в зависимости от ожидаемого типа параметра, а перегрузка выбирается по <strong>статическому</strong> типу. Стоит выражению стать <code>IEnumerable</code> (тип возврата, <code>AsEnumerable()</code>), — дальше всё выполняется в памяти.</li><li>Захваченные переменные превращаются в параметры SQL, литералы — в константы.</li><li>Непереводимый вызов (ваш метод в <code>Where</code>) EF Core 3+ не выполняет на клиенте молча, а бросает <code>InvalidOperationException</code> с «could not be translated». Исключение — финальная проекция <code>Select</code>, которую можно доделать на клиенте. Решение: переписать условие на переводимое или сознательно разделить запрос через <code>AsEnumerable()</code> после фильтров в базе.</li></ul>` },
    { id: `dotnet-035`, chapter: `async`, type: 'choice', q: `<p>Что выведет код?</p>
<pre><code>static async Task FailAsync(int x)
{
    if (x &lt; 0) throw new ArgumentException("x");
    await Task.Delay(10);
}

var t = FailAsync(-1);
Console.WriteLine("A");
try { await t; }
catch (ArgumentException) { Console.WriteLine("B"); }</code></pre>`, options: [`В строке <code>var t = FailAsync(-1)</code> вылетит <code>ArgumentException</code>, и <code>A</code> не напечатается`, `<code>A</code>, затем <code>B</code>`, `<code>A</code>, затем необработанное исключение`, `<code>B</code>, затем <code>A</code>`], answer: 1, explain: `<p>В <code>async</code>-методе <strong>любое</strong> исключение, даже брошенное до первого <code>await</code>, перехватывается сгенерированной state machine и сохраняется в возвращаемой задаче. Вызов возвращает уже упавшую задачу, <code>A</code> печатается, а исключение вылетает на <code>await t</code> и ловится.</p>
<p>Первый вариант был бы верен для метода без <code>async</code>, который вычисляет аргументы и возвращает <code>Task</code> (например, <code>return Inner(x);</code>), — там проверка выполняется синхронно. Именно поэтому в библиотеках иногда сознательно разделяют синхронную валидацию и асинхронное тело.</p>` },
    { id: `dotnet-036`, chapter: `async`, type: 'choice', q: `<p>Что выведет код?</p>
<pre><code>async Task Fail(string m) { await Task.Delay(10); throw new InvalidOperationException(m); }

var all = Task.WhenAll(Fail("one"), Fail("two"));
try { await all; }
catch (Exception ex)
{
    Console.WriteLine(ex.GetType().Name);
    Console.WriteLine(all.Exception!.InnerExceptions.Count);
}</code></pre>`, options: [`<code>AggregateException</code>, затем <code>2</code>`, `<code>AggregateException</code>, затем <code>1</code>`, `<code>InvalidOperationException</code>, затем <code>1</code>`, `<code>InvalidOperationException</code>, затем <code>2</code>`], answer: 3, explain: `<p>Задача <code>WhenAll</code> хранит <strong>все</strong> исключения в <code>AggregateException</code> (<code>all.Exception.InnerExceptions.Count == 2</code>), но <code>await</code> разворачивает агрегат и бросает <strong>первое</strong> исключение с сохранённым стеком.</p>
<p><code>AggregateException</code> вы бы поймали при <code>all.Wait()</code> или <code>all.Result</code>. Вывод: если нужны все ошибки параллельных операций, сохраните задачу <code>WhenAll</code> и прочитайте её <code>Exception</code> после <code>await</code>.</p>` },
    { id: `dotnet-037`, chapter: `async`, type: 'choice', q: `<code>GetAsync()</code> возвращает <code>ValueTask&lt;int&gt;</code>. Какое использование некорректно?`, options: [`<code>int x = await GetAsync();</code>`, `<code>Task&lt;int&gt; t = GetAsync().AsTask(); await t; await t;</code>`, `<code>var vt = GetAsync(); int a = await vt; int b = await vt;</code>`, `<code>var vt = GetAsync(); int x = vt.IsCompletedSuccessfully ? vt.Result : await vt;</code>`], answer: 2, explain: `<p><code>ValueTask</code> можно ждать <strong>только один раз</strong>: если за ним стоит <code>IValueTaskSource</code> из пула, после первого завершения источник может уже обслуживать другую операцию, и второй <code>await</code> прочитает чужой результат или упадёт.</p>
<p>Остальные варианты корректны: обычный однократный <code>await</code>; <code>AsTask()</code> превращает значение в настоящую <code>Task</code>, которую можно ждать сколько угодно; чтение <code>Result</code> после проверки <code>IsCompletedSuccessfully</code> — допустимый оптимизированный путь.</p>` },
    { id: `dotnet-038`, chapter: `async`, type: 'choice', q: `Что даёт <code>ConfigureAwait(false)</code> в коде контроллера приложения на ASP.NET Core?`, options: [`Практически ничего: в ASP.NET Core нет <code>SynchronizationContext</code>, и продолжение в любом случае выполняется на потоке пула`, `Предотвращает deadlock, если где-то выше по стеку вызван <code>.Result</code>`, `Гарантирует, что продолжение выполнится на том же потоке, который начал обрабатывать запрос`, `Отключает передачу <code>ExecutionContext</code>, поэтому <code>AsyncLocal</code> и <code>Activity.Current</code> перестают работать`], answer: 0, explain: `<p><code>ConfigureAwait(false)</code> означает «не возвращайся в захваченный <code>SynchronizationContext</code>». В ASP.NET Core его нет, так что в коде приложения поведение не меняется. В <strong>библиотеках</strong> его по-прежнему пишут: их могут вызвать из UI или старого ASP.NET, где контекст есть.</p>
<p>Про deadlock — смешение с классическим ASP.NET и UI: там <code>ConfigureAwait(false)</code> во всех <code>await</code> ниже по стеку действительно спасает от блокировки при <code>.Result</code>. <code>ExecutionContext</code> (и <code>AsyncLocal</code>) он не трогает — это делает <code>ExecutionContext.SuppressFlow</code>.</p>` },
    { id: `dotnet-039`, chapter: `async`, type: 'choice', q: `<p>Что вероятнее всего напечатает код, если <code>SendAsync</code> выполняется ~50 мс?</p>
<pre><code>var sent = 0;
orders.ForEach(async o =&gt;
{
    await SendAsync(o);
    Interlocked.Increment(ref sent);
});
Console.WriteLine(sent);</code></pre>`, options: [`Всегда <code>orders.Count</code>: <code>ForEach</code> дожидается асинхронных лямбд`, `Ошибка компиляции: <code>List&lt;T&gt;.ForEach</code> не принимает async-лямбды`, `<code>0</code>: лямбда превратилась в <code>async void</code>, <code>ForEach</code> не ждёт завершения, а исключение из <code>SendAsync</code> уронит процесс`, `<code>orders.Count</code>, но отправки выполнятся строго последовательно`], answer: 2, explain: `<p><code>ForEach</code> принимает <code>Action&lt;T&gt;</code>, поэтому async-лямбда компилируется в <code>async void</code>. Каждая итерация доходит до первого незавершённого <code>await</code> и возвращает управление; <code>ForEach</code> заканчивается почти сразу, а счётчик ещё нулевой. Исключение из <code>async void</code> нельзя поймать снаружи — оно уйдёт в пул как необработанное и завершит процесс.</p>
<p>Ошибки компиляции нет — в этом и опасность. Правильно: <code>foreach</code> с <code>await</code>, <code>Task.WhenAll</code> с ограничением параллелизма или <code>Parallel.ForEachAsync</code>.</p>` },
    { id: `dotnet-040`, chapter: `async`, type: 'open', q: `Что компилятор делает с async-методом? Когда при этом появляются аллокации?`, answer: `<ul><li>Метод превращается в <strong>state machine</strong>: параметры и локальные переменные становятся полями, тело — методом <code>MoveNext()</code> со <code>switch</code> по состоянию; исходный метод создаёт машину, вызывает <code>builder.Start</code> и возвращает <code>builder.Task</code>.</li><li><code>MoveNext</code> выполняется <strong>синхронно</strong> до первого <code>await</code>, чья задача не завершена. Тогда сохраняются состояние и awaiter, через <code>AwaitUnsafeOnCompleted</code> регистрируется продолжение, поток возвращается вызывающему. По завершении операции <code>MoveNext</code> вызывается снова и продолжает с нужного места.</li><li><code>await</code> — паттерн: <code>GetAwaiter()</code>, <code>IsCompleted</code>, <code>OnCompleted</code>, <code>GetResult()</code>.</li><li>Исключения ловит <code>try</code> вокруг тела и кладёт в задачу через <code>SetException</code>; результат — <code>SetResult</code>.</li><li>Аллокации: в Release машина — структура, и если метод завершился синхронно, выделяется только <code>Task</code> (а для частых результатов — <code>true</code>, небольших чисел, <code>null</code> — берётся кешированная). При первой реальной приостановке машина копируется в кучу вместе с задачей. <code>ValueTask</code> убирает аллокацию <code>Task</code> в синхронном случае.</li><li>Через <code>await</code> протекает <code>ExecutionContext</code> (на нём <code>AsyncLocal</code>); <code>SynchronizationContext</code> захватывается, если он есть.</li></ul>` },
    { id: `dotnet-041`, chapter: `async`, type: 'open', q: `В ASP.NET Core нет <code>SynchronizationContext</code>, значит <code>.Result</code> не вызовет deadlock. Почему sync-over-async там всё равно плохая практика?`, answer: `<ul><li><code>.Result</code>/<code>.Wait()</code> <strong>блокирует поток пула</strong> на всё время I/O, хотя async-API существует именно для того, чтобы поток не держать.</li><li>Под нагрузкой заблокированными оказываются все потоки пула. Продолжениям, которые завершили бы ожидаемые задачи, негде выполниться — они стоят в очереди. Это <strong>thread pool starvation</strong>.</li><li>Пул выше минимума добавляет потоки медленно (hill climbing и детектор голодания, порядка одного-двух в секунду), и каждый новый поток тоже блокируется.</li><li>Симптомы: растут latency и таймауты при <strong>низком CPU</strong>, падают health-check-и, число потоков ползёт вверх, очередь пула растёт. Видно в <code>dotnet-counters</code> и в дампе — сотни потоков в <code>Wait</code>.</li><li><code>.Result</code> оборачивает исключения в <code>AggregateException</code>, а <code>GetAwaiter().GetResult()</code> — нет, но блокирует так же.</li><li>Решение — async all the way; <code>SetMinThreads</code> — временный пластырь.</li></ul>` },
    { id: `dotnet-042`, chapter: `async`, type: 'open', q: `Вы оборачиваете ответ из очереди сообщений в <code>Task</code> через <code>TaskCompletionSource</code>. Зачем нужен <code>TaskCreationOptions.RunContinuationsAsynchronously</code> и какие ещё есть правила?`, answer: `<ul><li>По умолчанию продолжения задачи выполняются <strong>синхронно внутри <code>SetResult</code></strong>, на потоке, который его вызвал. Если <code>SetResult</code> вызывает цикл потребителя сообщений, весь код после <code>await</code> у ожидающего выполнится прямо в этом цикле и задержит чтение следующих сообщений.</li><li>Если <code>SetResult</code> вызывается под <code>lock</code>, продолжение выполнится под чужой блокировкой — путь к deadlock-ам и реентерабельности.</li><li><code>RunContinuationsAsynchronously</code> отправляет продолжения в пул, и <code>SetResult</code> возвращается сразу.</li><li>Использовать <code>TrySetResult</code>/<code>TrySetException</code>/<code>TrySetCanceled</code>, если завершить могут несколько участников (ответ, таймаут, отмена) — второй <code>SetResult</code> бросит исключение.</li><li><strong>Всегда</strong> завершать TCS: незавершённая задача — навсегда повисший запрос и утечка всего, что захвачено продолжениями.</li><li>Регистрацию отмены (<code>token.Register(...)</code>) освобождать после завершения; запись в словаре ожидающих удалять во всех ветках.</li></ul>` },
    { id: `dotnet-043`, chapter: `async`, type: 'open', q: `Как правильно сделать таймаут на вызов внешнего сервиса с учётом отмены запроса клиентом?`, answer: `<ul><li>Создать связанный источник: <code>using var cts = CancellationTokenSource.CreateLinkedTokenSource(requestToken);</code> и <code>cts.CancelAfter(timeout)</code> — операция отменится и при разрыве запроса клиентом, и по таймауту.</li><li>Передать <code>cts.Token</code> <strong>во все</strong> I/O-вызовы (<code>HttpClient</code>, EF Core, драйвер Kafka), а в долгих CPU-циклах проверять <code>ThrowIfCancellationRequested()</code>.</li><li>Освободить linked source (<code>using</code>): иначе в долгоживущем родительском токене копятся регистрации.</li><li>Отличать причину: если <code>OperationCanceledException</code> и <code>requestToken.IsCancellationRequested</code> — клиент ушёл, логировать как ошибку не нужно; иначе — таймаут, его стоит перевести в понятную ошибку (<code>TimeoutException</code>, 504).</li><li><code>task.WaitAsync(timeout)</code> перестаёт <strong>ждать</strong>, но саму операцию не отменяет — она продолжает потреблять ресурсы; для настоящей отмены нужен токен.</li><li>Для <code>HttpClient</code> есть свой <code>Timeout</code> и политики устойчивости (<code>Microsoft.Extensions.Http.Resilience</code>), но токен запроса всё равно стоит пробрасывать.</li></ul>` },
    { id: `dotnet-044`, chapter: `threading`, type: 'choice', q: `Поле объявлено как <code>private volatile int _count;</code>. Четыре потока по миллиону раз выполняют <code>_count++</code>. Каким будет итог?`, options: [`Ровно 4 000 000: <code>volatile</code> делает операцию атомарной`, `Ошибка компиляции: <code>++</code> нельзя применять к <code>volatile</code>-полю`, `Ровно 4 000 000 на x64 и меньше на ARM из-за слабой модели памяти`, `Как правило, меньше 4 000 000: <code>++</code> — это чтение, сложение и запись, и инкременты теряются; нужен <code>Interlocked.Increment</code>`], answer: 3, explain: `<p><code>volatile</code> гарантирует порядок и «свежесть» отдельных чтений и записей (acquire/release), но не атомарность составной операции. Два потока могут прочитать одно и то же значение и записать одинаковый результат — один инкремент пропадёт. <code>Interlocked.Increment</code> выполняет чтение-изменение-запись атомарно.</p>
<p>Гонка проявляется и на x64: сильная модель памяти x86 защищает от некоторых переупорядочиваний, но не делает три отдельные операции одной.</p>` },
    { id: `dotnet-045`, chapter: `threading`, type: 'choice', q: `<p>Что будет с этим кодом?</p>
<pre><code>private readonly object _gate = new();

public async Task UpdateAsync()
{
    lock (_gate)
    {
        await _repository.SaveAsync();
    }
}</code></pre>`, options: [`Скомпилируется, но может привести к deadlock под нагрузкой`, `Ошибка компиляции CS1996: <code>await</code> нельзя использовать в теле оператора <code>lock</code>`, `Скомпилируется: компилятор сам заменит <code>lock</code> на <code>SemaphoreSlim</code>`, `Скомпилируется и будет работать корректно только с <code>ConfigureAwait(false)</code>`], answer: 1, explain: `<p><code>Monitor</code> привязан к потоку: освободить его может только поток, который захватил. После <code>await</code> продолжение может выполниться на другом потоке, поэтому компилятор запрещает <code>await</code> внутри <code>lock</code>. Для асинхронного взаимного исключения используют <code>SemaphoreSlim(1, 1)</code> с <code>WaitAsync</code> и <code>Release</code> в <code>finally</code>.</p>
<p>Вариант «скомпилируется, но deadlock» описывает ситуацию с <code>Monitor.Enter</code>/<code>Monitor.Exit</code>, вызванными вручную вокруг <code>await</code>: компилятор это не поймает, а <code>Exit</code> на другом потоке бросит <code>SynchronizationLockException</code>. С новым <code>System.Threading.Lock</code> правило то же.</p>` },
    { id: `dotnet-046`, chapter: `threading`, type: 'choice', q: `<p>Что не так с этим кодом?</p>
<pre><code>Parallel.ForEach(urls, async url =&gt; await DownloadAsync(url));
Console.WriteLine("done");</code></pre>`, options: [`<code>done</code>, скорее всего, напечатается до окончания загрузок: лямбда стала <code>async void</code>, и <code>Parallel.ForEach</code> ждёт каждую лишь до её первого <code>await</code>`, `Ничего: <code>Parallel.ForEach</code> распознаёт async-лямбды и дожидается их задач`, `Ошибка компиляции: <code>Parallel.ForEach</code> не принимает async-лямбды`, `Загрузки выполнятся строго последовательно, параллелизма не будет`], answer: 0, explain: `<p><code>Parallel.ForEach</code> принимает <code>Action&lt;T&gt;</code>, так что лямбда — <code>async void</code>. Цикл считает итерацию завершённой, как только лямбда вернула управление на первом <code>await</code>, и заканчивается, пока загрузки ещё идут. Исключения из них не дойдут до вызывающего, а уронят процесс.</p>
<p>Для асинхронной работы над множеством элементов с ограничением параллелизма — <code>Parallel.ForEachAsync</code> (.NET 6) с <code>MaxDegreeOfParallelism</code>. <code>Parallel.ForEach</code> — для синхронной CPU-bound работы.</p>` },
    { id: `dotnet-047`, chapter: `threading`, type: 'open', q: `Как проявляется и как диагностируется thread pool starvation в продакшене?`, answer: `<ul><li><strong>Причина</strong>: блокирующие вызовы на потоках пула — <code>.Result</code>, <code>.Wait()</code>, синхронный I/O, <code>Thread.Sleep</code>, долгие <code>lock</code>. Под всплеском нагрузки все потоки заблокированы, а продолжения, которые их разбудили бы, ждут в очереди.</li><li><strong>Почему не рассасывается</strong>: выше минимума (по умолчанию — число ядер) пул добавляет потоки медленно, порядка одного-двух в секунду, и новые тоже блокируются.</li><li><strong>Симптомы</strong>: резкий рост latency и таймаутов при низком CPU, падающие health-check-и и рестарты подов, медленно растущее число потоков.</li><li><strong>Диагностика</strong>: <code>dotnet-counters monitor --counters System.Runtime</code> — растёт длина очереди пула и число потоков, падает число завершённых элементов; <code>dotnet-stack report</code> или дамп (<code>dotnet-dump analyze</code>, <code>clrstack -all</code>) — множество потоков в <code>Task.Wait</code>, <code>Monitor.Enter</code>, <code>ManualResetEventSlim.Wait</code>.</li><li><strong>Лечение</strong>: убрать sync-over-async по найденным стекам; долгим блокирующим циклам (синхронный <code>Consume</code> Kafka) дать выделенный поток; <code>ThreadPool.SetMinThreads</code> — временная мера, снимающая симптом.</li></ul>` },
    { id: `dotnet-048`, chapter: `threading`, type: 'open', q: `<code>lock</code>, <code>SemaphoreSlim</code>, <code>Interlocked</code>, <code>ReaderWriterLockSlim</code>, <code>Channel</code> — когда что использовать?`, answer: `<ul><li><strong><code>lock</code></strong> (на <code>System.Threading.Lock</code> в .NET 9+): короткая синхронная критическая секция. Реентерабелен, привязан к потоку, без <code>await</code> внутри.</li><li><strong><code>SemaphoreSlim(1, 1)</code> + <code>WaitAsync</code></strong>: взаимное исключение, внутри которого нужен <code>await</code>. Не реентерабелен, <code>Release</code> в <code>finally</code>. <code>SemaphoreSlim(N)</code> — ограничение числа одновременных вызовов внешнего ресурса.</li><li><strong><code>Interlocked</code></strong>: одна переменная — счётчик, флаг, атомарная замена ссылки на неизменяемый снимок; сложнее — CAS-цикл с <code>CompareExchange</code>.</li><li><strong><code>ReaderWriterLockSlim</code></strong>: много чтений, редкие записи и нетривиальная секция чтения. Синхронный, привязан к потоку; на коротких секциях <code>lock</code> часто быстрее. Альтернатива — неизменяемый снимок (<code>FrozenDictionary</code>) и атомарная подмена ссылки, тогда читатели не синхронизируются вовсе.</li><li><strong><code>Channel&lt;T&gt;</code></strong>: передача данных между частями приложения (producer/consumer), bounded — с backpressure.</li><li>Плюс готовые примитивы: <code>Lazy&lt;T&gt;</code> для инициализации, concurrent-коллекции и <code>HybridCache</code> для общих данных — вместо самописного lock-free.</li></ul>` },
    { id: `dotnet-049`, chapter: `threading`, type: 'open', q: `Сервис читает события из Kafka и пишет их в PostgreSQL. Как с помощью <code>Channel&lt;T&gt;</code> развязать чтение и запись и не потерять управление памятью?`, answer: `<ul><li>Потребитель Kafka (на выделенном потоке или в <code>BackgroundService</code>) пишет сообщения в <strong>bounded</strong> канал: <code>Channel.CreateBounded&lt;T&gt;(new BoundedChannelOptions(N) { FullMode = BoundedChannelFullMode.Wait, SingleReader = true })</code>.</li><li>Отдельный <code>BackgroundService</code> читает <code>ReadAllAsync(ct)</code>, набирает пачку (по размеру или по времени) и пишет её в базу одним запросом или <code>COPY</code>.</li><li><strong>Backpressure</strong>: если база тормозит, канал заполняется, <code>WriteAsync</code> ждёт, и потребитель перестаёт брать новые сообщения — память не растёт. Unbounded канал в этой ситуации превратился бы в утечку.</li><li><strong>Коммит оффсетов</strong> — только после успешной записи пачки в базу, иначе при падении процесса сообщения из канала будут потеряны: канал в памяти, а Kafka считает их обработанными. Обработка должна быть идемпотентной (повторная доставка после рестарта неизбежна).</li><li><strong>Остановка</strong>: по <code>stoppingToken</code> прекратить чтение, вызвать <code>Writer.Complete()</code>, дать писателю дочитать и записать остаток, закоммитить оффсеты.</li><li>Ошибки писателя — повтор с ограничением или остановка с <code>Complete(exception)</code>, чтобы не крутить чтение в пустоту.</li></ul>` },
    { id: `dotnet-050`, chapter: `runtime`, type: 'choice', q: `<p>Что окажется в <code>StackTrace</code> перехваченного снаружи исключения?</p>
<pre><code>void A() =&gt; B();
void B() =&gt; throw new InvalidOperationException();

try
{
    try { A(); }
    catch (Exception ex) { throw ex; }
}
catch (Exception ex) { Console.WriteLine(ex.StackTrace); }</code></pre>`, options: [`Кадры <code>B</code> и <code>A</code>, как у исходного исключения`, `Пустая строка`, `Только кадр метода, где выполнен <code>throw ex</code>; кадров <code>A</code> и <code>B</code> не будет`, `Кадры <code>B</code>, <code>A</code> и пометка о повторном броске`], answer: 2, explain: `<p><code>throw ex;</code> бросает объект заново и <strong>перезаписывает</strong> трассировку: она начинается с места повторного броска, и информация о том, что ошибка случилась в <code>B</code>, теряется. <code>throw;</code> пробрасывает исключение, сохраняя исходную трассировку.</p>
<p>Вариант с «пометкой о повторном броске» описывает <code>ExceptionDispatchInfo.Capture(ex).Throw()</code>: он сохраняет исходные кадры и дописывает точку повторного броска — так <code>await</code> пробрасывает исключения из задач.</p>` },
    { id: `dotnet-051`, chapter: `runtime`, type: 'choice', q: `<p>В каком порядке будут напечатаны строки?</p>
<pre><code>try { Inner(); }
catch (Exception) when (Log("filter")) { Log("catch"); }

void Inner()
{
    try { throw new Exception(); }
    finally { Log("finally"); }
}

bool Log(string s) { Console.Write(s + " "); return true; }</code></pre>`, options: [`<code>finally filter catch</code>`, `<code>filter finally catch</code>`, `<code>filter catch finally</code>`, `<code>finally catch filter</code>`], answer: 1, explain: `<p>Обработка исключения идёт в два прохода. На <strong>первом</strong> рантайм ищет обработчик и вычисляет фильтры — стек ещё не раскручен, и <code>finally</code> во <code>Inner</code> ещё не выполнен. Фильтр вернул <code>true</code>, обработчик найден. На <strong>втором</strong> проходе стек раскручивается: выполняется <code>finally</code>, затем управление передаётся в <code>catch</code>.</p>
<p>Интуитивный ответ «finally filter catch» предполагает, что фильтр — часть <code>catch</code> и вычисляется после раскрутки. Именно потому, что это не так, фильтры сохраняют стек нетронутым для дампов и позволяют логировать, не перехватывая.</p>` },
    { id: `dotnet-052`, chapter: `runtime`, type: 'open', q: `Что такое tiered compilation и Dynamic PGO? Почему из-за них важен прогрев и что это значит для бенчмарков?`, answer: `<ul><li><strong>Tier 0</strong>: при первом вызове метод компилируется быстро и почти без оптимизаций — ради быстрого старта.</li><li>Рантайм считает вызовы; горячий метод (порог около 30 вызовов) перекомпилируется в <strong>Tier 1</strong> с полной оптимизацией в фоне, и вызовы переключаются на новый код. С .NET 7 <strong>OSR</strong> позволяет перейти на оптимизированный код посреди долгого цикла.</li><li>В Tier 1 <code>static readonly</code>-значения уже известны и используются как константы — целые ветки исчезают.</li><li><strong>Dynamic PGO</strong> (по умолчанию с .NET 8): перед финальной оптимизацией горячий метод проходит через инструментированную версию, собирающую профиль — какие типы реально приходят в виртуальные вызовы, какие ветки горячие. Оптимизированный код использует <strong>guarded devirtualization</strong> («если это <code>List&lt;int&gt;</code> — прямой заинлайненный вызов») и раскладку горячего и холодного кода.</li><li>Следствия: первые запросы к сервису медленнее (прогрев, warmup-запросы перед вводом в балансировку; ReadyToRun ускоряет старт). Бенчмарк через <code>Stopwatch</code> без прогрева измеряет Tier 0 и врёт — BenchmarkDotNet делает прогрев, многократные итерации и статистику сам.</li></ul>` },
    { id: `dotnet-053`, chapter: `runtime`, type: 'open', q: `Чем ReadyToRun отличается от NativeAOT? Какие ограничения у NativeAOT и когда его стоит выбирать?`, answer: `<ul><li><strong>ReadyToRun</strong>: IL предкомпилируется в машинный код и хранится в сборке рядом с IL. JIT остаётся: старт быстрее, а горячие методы всё равно перекомпилируются в Tier 1 с PGO. Сборки больше и платформенно-зависимые. Совместим практически со всем.</li><li><strong>NativeAOT</strong>: всё приложение и рантайм компилируются в один нативный файл, JIT отсутствует, trimming обязателен. Старт за миллисекунды, меньше памяти и размер образа, не нужен установленный .NET.</li><li><strong>Ограничения NativeAOT</strong>: нет генерации кода в рантайме (<code>Reflection.Emit</code>; <code>Expression.Compile</code> интерпретируется); нельзя грузить сборки динамически; reflection только для того, что видно статически или аннотировано (<code>DynamicallyAccessedMembers</code>), — нужно разбирать trim-предупреждения; сериализация через source generators; в ASP.NET Core — minimal APIs, без MVC-контроллеров; EF Core поддерживается ограниченно; сборка под конкретную ОС и архитектуру; нет tiered PGO, поэтому пиковая производительность долгоживущего сервиса может быть ниже.</li><li><strong>Когда</strong>: CLI-утилиты, serverless и функции с холодным стартом, sidecar-ы, маленькие сервисы с частым масштабированием с нуля. Для типичного долгоживущего сервиса с EF Core и контроллерами обычный JIT (плюс ReadyToRun при необходимости) практичнее.</li></ul>` },
    { id: `dotnet-054`, chapter: `runtime`, type: 'open', q: `Почему source generators вытесняют reflection? Приведите примеры из платформы.`, answer: `<ul><li>Reflection работает <strong>в рантайме</strong>: поиск по метаданным, проверки, упаковка аргументов, медленный первый вызов; ломается под trimming и NativeAOT; ошибки (опечатка в имени свойства) видны только при выполнении.</li><li>Source generator — расширение Roslyn (<code>IIncrementalGenerator</code>), которое <strong>во время компиляции</strong> генерирует обычный C#-код по вашему коду и атрибутам: его видно в IDE, его можно отлаживать, он совместим с AOT, не тратит время при старте, а ошибки — ошибки сборки.</li><li>Примеры: <code>System.Text.Json</code> с <code>JsonSerializerContext</code> и <code>[JsonSerializable]</code>; <code>[GeneratedRegex]</code> (.NET 7); <code>[LoggerMessage]</code> — логирование без упаковки и разбора шаблона; <code>[LibraryImport]</code> для P/Invoke; генераторы привязки конфигурации и делегатов minimal API (.NET 8). Из экосистемы — Mapperly вместо AutoMapper.</li><li>Если reflection неизбежен — кешировать <code>MemberInfo</code> и строить делегаты один раз; для доступа к приватному члену — <code>[UnsafeAccessor]</code> (.NET 8) без reflection вовсе.</li></ul>` },
    { id: `dotnet-055`, chapter: `new`, type: 'choice', q: `Какое утверждение о primary constructors классов (C# 12) верно?`, options: [`Параметры становятся публичными <code>init</code>-свойствами, как у позиционного <code>record</code>`, `Параметры всегда <code>readonly</code>: присвоить им новое значение в методе нельзя`, `Primary constructors доступны только для <code>record</code> и <code>struct</code>`, `Параметр, используемый в методах, захватывается компилятором в скрытое изменяемое поле; свойства не генерируются`], answer: 3, explain: `<p>У класса с primary constructor параметры — это просто параметры, доступные во всём теле типа. Если член класса их использует, компилятор создаёт скрытое поле, и оно <strong>изменяемо</strong> — параметр можно переприсвоить, <code>readonly</code> для него написать нельзя. Публичные свойства генерируются только у <code>record</code>.</p>
<p>Вариант про <code>readonly</code> — самое частое ожидание, и как раз поэтому многие команды вводят правило анализатора или явно присваивают параметр в <code>private readonly</code>-поле.</p>` },
    { id: `dotnet-056`, chapter: `new`, type: 'choice', q: `<p>Что произойдёт при выполнении кода на C# 14?</p>
<pre><code>Order? order = null;
order?.Status = Compute();</code></pre>`, options: [`Ничего: <code>order</code> равен <code>null</code>, присваивание пропускается, и <code>Compute()</code> не вызывается`, `<code>Compute()</code> вызовется, а результат будет отброшен`, `<code>NullReferenceException</code>`, `Ошибка компиляции: <code>?.</code> нельзя использовать слева от <code>=</code>`], answer: 0, explain: `<p>C# 14 добавил null-conditional присваивание: если объект слева <code>null</code>, всё выражение пропускается, <strong>включая вычисление правой части</strong>. Это эквивалент <code>if (order is not null) order.Status = Compute();</code>.</p>
<p>Ошибка компиляции была бы до C# 14 — именно это помнят многие разработчики. Вариант «Compute вызовется» неверен: правая часть вычисляется только тогда, когда присваивание действительно выполняется.</p>` },
    { id: `dotnet-057`, chapter: `new`, type: 'open', q: `Что из нововведений .NET 8–10 вы бы назвали самым полезным для бэкенда и почему?`, answer: `<p>Сильный ответ связывает фичу с проблемой, а не перечисляет список. Например:</p>
<ul><li><strong><code>TimeProvider</code></strong> (.NET 8) — абстракция времени и таймеров в BCL: тесты сроков резервирования и таймаутов без <code>Thread.Sleep</code> и самописных <code>IClock</code> (<code>FakeTimeProvider.Advance</code>).</li><li><strong>Keyed services</strong> (.NET 8) — несколько реализаций интерфейса в DI без фабрик.</li><li><strong>Frozen-коллекции</strong> (.NET 8) — быстрые справочники, построенные при старте.</li><li><strong><code>HybridCache</code></strong> (эпоха .NET 9) — двухуровневый кеш с защитой от stampede: при промахе фабрика для ключа выполняется один раз.</li><li><strong><code>Guid.CreateVersion7()</code></strong> (.NET 9) — монотонные идентификаторы, генерируемые в приложении, — меньше разбиений страниц B-tree-индекса, чем у случайных v4.</li><li><strong><code>Lock</code></strong> (.NET 9) и <strong><code>params ReadOnlySpan&lt;T&gt;</code></strong> (C# 13) — понятнее намерение и меньше аллокаций.</li><li><strong>C# 14</strong>: extension-свойства и статические extension-члены, <code>field</code> для свойств с логикой, null-conditional присваивание.</li><li><strong>.NET 10</strong> — LTS до ноября 2028; это главный повод мигрировать с .NET 8, поддержка которого заканчивается в ноябре 2026. Про миграцию: обновить TFM и пакеты, пройти breaking changes, прогнать нагрузку и сравнить метрики GC и latency.</li></ul>` },
    { id: `dotnet-058`, chapter: `new`, type: 'choice', q: `<p>Что означает <code>field</code> в этом свойстве (C# 14)?</p>
<pre><code>public string Sku
{
    get;
    set =&gt; field = value.Trim().ToUpperInvariant();
}</code></pre>`, options: [`Автоматически созданное компилятором backing field этого свойства; объявлять поле вручную не нужно`, `Поле с именем <code>field</code>, которое нужно объявить в классе, иначе будет ошибка компиляции`, `Ссылку на значение свойства в базовом классе`, `Локальную переменную аксессора, которая сбрасывается при каждом вызове`], answer: 0, explain: `<p>В C# 14 ключевое слово <code>field</code> внутри аксессора обращается к backing field, которое компилятор создаёт сам, как для автосвойства. Так можно добавить логику в одну половину свойства (<code>set</code> с нормализацией или проверкой), оставив другую автоматической (<code>get;</code>), и не писать <code>private string _sku;</code>.</p>
<p>Вариант про обычное поле с именем <code>field</code> был верен до C# 14 — и остаётся ловушкой при обновлении: если в типе уже есть член <code>field</code>, внутри аксессора теперь нужно писать <code>@field</code> или <code>this.field</code>.</p>` }
  ]
});
