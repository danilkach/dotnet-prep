window.PREP = window.PREP || [];
window.PREP.push({
  id: 'kafka',
  title: 'Kafka и асинхронное взаимодействие',
  chapters: [
    {
      id: 'architecture',
      title: 'Архитектура',
      html: `
<h3>Kafka — это распределённый лог, а не очередь</h3>
<p>Первое, что стоит сказать на собеседовании, и что сразу отличает человека, работавшего с Kafka, от человека, читавшего про «брокер сообщений»: Kafka — это <strong>распределённый, реплицируемый, append-only лог</strong>. Сообщение не «доставляется и исчезает», как в классической очереди. Оно дописывается в конец лога и лежит там, пока его не удалит политика хранения (retention). Читатели (consumers) сами помнят, до какого места они дочитали, — это и есть <strong>offset</strong>. Поэтому одно и то же сообщение могут независимо прочитать десять разных сервисов, а один сервис может перечитать историю заново (replay), просто передвинув свой offset назад.</p>
<p>Из этой модели вытекает почти всё остальное: масштабирование через partitions, гарантия порядка только внутри partition, consumer groups, retention, log compaction, exactly-once через транзакции. Если на любой вопрос по Kafka вы начинаете рассуждение с «это лог, у каждого читателя свой offset», вы почти всегда придёте к правильному ответу.</p>

<h3>Broker, topic, partition</h3>
<p><strong>Broker</strong> — это один процесс Kafka (JVM), обычно один на машину или под. Кластер — несколько брокеров. Клиент подключается к любому брокеру из <code>bootstrap.servers</code>, получает метаданные кластера (какие брокеры есть, кто лидер какой partition) и дальше ходит напрямую к нужным брокерам. Поэтому в <code>bootstrap.servers</code> достаточно указать два-три адреса — это только точка входа, а не полный список.</p>
<p><strong>Topic</strong> — логическое имя потока событий: <code>orders.created</code>, <code>payments.events</code>. Сам по себе topic — это просто набор partitions.</p>
<p><strong>Partition</strong> — физическая единица хранения и параллелизма. Каждая partition — это отдельный упорядоченный лог. Внутри partition у каждой записи есть offset — монотонно растущее 64-битное число: 0, 1, 2, … Offsets уникальны только в пределах partition: offset 42 в partition 0 и offset 42 в partition 1 — разные сообщения.</p>
<ul>
  <li><strong>Порядок гарантируется только внутри partition.</strong> Между partitions одного topic никакого глобального порядка нет.</li>
  <li><strong>Partition — единица параллелизма.</strong> В одной consumer group одну partition в каждый момент читает ровно один consumer. Значит, 12 partitions — это максимум 12 параллельных читателей в группе.</li>
  <li><strong>Partition — единица репликации.</strong> У каждой partition свой лидер и свои реплики на разных брокерах.</li>
</ul>
<p>Сообщение попадает в конкретную partition через <strong>partitioner</strong> на стороне producer: если у сообщения есть key, partition выбирается по хэшу ключа, поэтому все события одного заказа (key = orderId) всегда ложатся в одну partition и сохраняют порядок. Подробно — в главе про producer.</p>
<blockquote><strong>Важно.</strong> Количество partitions можно увеличить, но нельзя уменьшить. И при увеличении меняется отображение key → partition: новые события заказа могут уйти в другую partition, чем старые, и порядок по ключу ломается на переходе. Поэтому число partitions закладывают с запасом сразу.</blockquote>

<h3>Что такое запись (record)</h3>
<p>Запись в Kafka состоит из: <strong>key</strong> (байты, может быть null), <strong>value</strong> (байты, может быть null — это важно для compaction), <strong>headers</strong> (список пар ключ–байты; сюда кладут trace context, тип события, correlation id), <strong>timestamp</strong> и offset, который назначает брокер. Kafka не знает ничего о формате данных — для неё это байты. Сериализация полностью на стороне клиентов (JSON, Avro, Protobuf — см. главу о схемах).</p>
<p>Timestamp бывает двух типов (настройка topic <code>message.timestamp.type</code>): <code>CreateTime</code> — время, которое поставил producer, и <code>LogAppendTime</code> — время записи на брокер. По timestamp работает retention по времени и поиск offset по времени (<code>OffsetsForTimes</code>), который нужен для replay «с 14:00 вчерашнего дня».</p>
<p>Записи передаются и хранятся не поштучно, а <strong>batch-ами</strong> (RecordBatch). У batch есть заголовок: base offset, producer id, producer epoch, base sequence (для идемпотентности), атрибуты (тип сжатия, признак транзакционности и control-batch). Сжатие применяется ко всему batch целиком, и брокер, как правило, хранит его на диске в том же сжатом виде, в каком получил.</p>

<h3>Как partition лежит на диске: segments и indexes</h3>
<p>Partition на диске — это директория вида <code>orders-3/</code> внутри <code>log.dirs</code>. Лог не хранится одним бесконечным файлом: он разбит на <strong>segments</strong>. Каждый segment — это набор файлов с общим именем, равным base offset первой записи сегмента (20 цифр с ведущими нулями):</p>
<pre><code>orders-3/
  00000000000000000000.log        // сами записи (batch-и)
  00000000000000000000.index      // offset -&gt; позиция в .log
  00000000000000000000.timeindex  // timestamp -&gt; offset
  00000000000005832104.log        // следующий сегмент
  00000000000005832104.index
  00000000000005832104.timeindex
  00000000000005832104.snapshot   // состояние producer-ов (для идемпотентности)
  leader-epoch-checkpoint</code></pre>
<p>Запись идёт только в последний, <strong>активный segment</strong>. Когда он достигает <code>segment.bytes</code> (по умолчанию 1 ГиБ) или стареет на <code>segment.ms</code> (по умолчанию 7 дней), брокер закрывает его («roll») и открывает новый. Закрытые сегменты неизменяемы.</p>
<p><strong>Индексы разреженные (sparse)</strong>: в <code>.index</code> не на каждую запись, а примерно на каждые <code>log.index.interval.bytes</code> (по умолчанию 4 КБ) данных пишется пара «относительный offset → байтовая позиция в файле». Чтобы найти запись с offset N, брокер:</p>
<ol>
  <li>бинарным поиском по base offset сегментов находит нужный сегмент (имена файлов отсортированы);</li>
  <li>бинарным поиском по <code>.index</code> (он отображён в память через mmap) находит ближайшую меньшую позицию;</li>
  <li>последовательно читает <code>.log</code> от этой позиции до нужной записи — это несколько килобайт.</li>
</ol>
<p><code>.timeindex</code> работает так же, но по времени: «первый offset с timestamp не меньше T». Через него реализованы retention по времени и поиск offset по времени.</p>
<p>Зачем сегменты? Удаление и compaction работают <strong>на уровне сегментов</strong>. Удалить старые данные — значит просто удалить файлы закрытого сегмента целиком, без перезаписи. Это дёшево и не мешает записи.</p>

<h3>Retention: по времени и по размеру</h3>
<p>Политика очистки задаётся на topic параметром <code>cleanup.policy</code>: <code>delete</code> (по умолчанию), <code>compact</code> или <code>compact,delete</code>.</p>
<p>При <code>delete</code> действуют два ограничения, срабатывает то, что наступит раньше:</p>
<ul>
  <li><code>retention.ms</code> — по умолчанию 7 дней (на брокере <code>log.retention.hours=168</code>). Сегмент удаляется, когда самая новая запись в нём старше этого срока.</li>
  <li><code>retention.bytes</code> — по умолчанию -1, то есть без ограничения. Ограничение действует <strong>на одну partition</strong>, а не на весь topic: topic из 12 partitions с <code>retention.bytes=10GB</code> может занять 120 ГБ (умножить ещё на replication factor).</li>
</ul>
<p>Тонкости, которые любят спрашивать:</p>
<ul>
  <li>Удаляются только целые закрытые сегменты; активный сегмент не удаляется никогда. Поэтому данные живут немного дольше, чем retention: сообщение может пережить срок, пока его сегмент не закрыт и не стал целиком старым.</li>
  <li>Retention не смотрит, прочитано ли сообщение. Если consumer лежал дольше retention, он потеряет непрочитанные данные: его committed offset окажется меньше самого раннего доступного, и сработает <code>auto.offset.reset</code> (earliest или latest). Это реальный сценарий потери данных — мониторинг lag обязателен.</li>
</ul>

<h3>Log compaction и tombstones</h3>
<p>При <code>cleanup.policy=compact</code> Kafka гарантирует другое: для каждого ключа в логе останется <strong>как минимум последнее значение</strong>. Старые значения того же ключа фоновый процесс (log cleaner) удаляет. Topic превращается в «журнал изменений таблицы»: перечитав его с начала, вы восстанавливаете актуальное состояние по каждому ключу. Типичные применения: снимки состояния (текущий профиль клиента, текущая цена товара), changelog-топики Kafka Streams, сам <code>__consumer_offsets</code> — он compacted.</p>
<p>Как это работает:</p>
<ul>
  <li>Лог делится на «чистую» часть (уже compacted) и «грязную» (head). Cleaner берёт сегменты, строит в памяти карту «ключ → последний offset» и переписывает сегменты, выбрасывая записи, у которых есть более новая версия.</li>
  <li><strong>Offsets не меняются.</strong> После compaction в логе появляются «дыры» — offset 10, 11, 15, 20. Порядок оставшихся записей сохраняется. Consumer к дырам относится нормально.</li>
  <li>Активный сегмент не компактится, поэтому дубликаты по ключу в свежих данных всегда есть. Compaction — это «в итоге», а не «немедленно».</li>
  <li>Когда запускать cleaner, регулируют <code>min.cleanable.dirty.ratio</code> (по умолчанию 0.5) и <code>min.compaction.lag.ms</code> / <code>max.compaction.lag.ms</code>.</li>
</ul>
<p><strong>Tombstone</strong> — это запись с ключом и <code>value = null</code>. Она означает «ключ удалён». Compaction удалит все предыдущие значения ключа, а сам tombstone продержится ещё <code>delete.retention.ms</code> (по умолчанию 1 сутки), чтобы consumers, которые читают с отставанием, успели увидеть удаление. Потом исчезнет и он. Отсюда вопрос с подвохом: consumer, который начнёт читать compacted topic с нуля спустя неделю, удалённый ключ не увидит вообще — ни значения, ни tombstone, — и это корректно.</p>
<p>Compaction требует ключей: запись без ключа в compacted topic брокер отвергнет. При <code>compact,delete</code> работают обе политики: последнее значение по ключу хранится, но не дольше retention.</p>

<h3>Controller, ZooKeeper и KRaft</h3>
<p>В кластере кто-то должен управлять метаданными: какие topics и partitions есть, где реплики, кто лидер, кто в ISR, ACL, конфиги. Это делает <strong>controller</strong>.</p>
<p>Исторически метаданные хранились в <strong>ZooKeeper</strong>, а один из брокеров выбирался controller-ом через ZooKeeper. Проблемы этой схемы: отдельная распределённая система, которую надо эксплуатировать и защищать; при failover новый controller должен вычитать все метаданные из ZooKeeper, что на сотнях тысяч partitions занимало минуты; ограничение на общее число partitions в кластере.</p>
<p><strong>KRaft</strong> (KIP-500) — режим, в котором Kafka управляет метаданными сама. Несколько узлов (обычно 3 или 5) работают в роли controller (<code>process.roles=controller</code>) и образуют кворум на протоколе Raft. Метаданные хранятся как лог событий во внутреннем topic <code>__cluster_metadata</code>: один controller — активный лидер кворума, остальные — горячие резервы с той же копией лога. Брокеры (<code>process.roles=broker</code>) подписаны на этот лог и применяют изменения у себя. Плюсы: нет второй системы, failover controller-а быстрый (резерв уже держит состояние в памяти), масштабируемость до миллионов partitions. Узел может совмещать обе роли (combined mode), но для продакшена это рекомендуют только для небольших/тестовых установок.</p>
<p>Хронология, которую полезно помнить: KRaft признан production-ready для новых кластеров в Kafka 3.3; ZooKeeper-режим объявлен устаревшим в 3.5; линия 3.x содержала инструменты миграции ZooKeeper → KRaft (3.9 — последний релиз с ZooKeeper); <strong>Kafka 4.0 (март 2025) полностью удалила ZooKeeper</strong> — работает только KRaft. Чтобы обновить старый кластер на 4.x, его сначала мигрируют на KRaft на 3.x. В 4.0 также убраны древние форматы сообщений v0/v1 и сделан GA новый протокол consumer group (KIP-848, см. главу про consumer).</p>
<blockquote>Для клиента (вашего .NET-сервиса) переход на KRaft прозрачен: клиенты и раньше не ходили в ZooKeeper напрямую (если не считать очень старых версий). Меняется эксплуатация, а не код.</blockquote>

<h3>Почему Kafka быстрая</h3>
<p>Это классический вопрос, и сильный ответ перечисляет конкретные механизмы, а не «потому что она для big data».</p>
<ol>
  <li><strong>Последовательный I/O.</strong> Запись — только append в конец файла, чтение consumer-ом — последовательное чтение подряд идущих записей. Последовательный доступ к диску (и HDD, и SSD) на порядки быстрее случайного; нет B-деревьев, нет обновлений на месте.</li>
  <li><strong>Page cache операционной системы.</strong> Kafka почти не кэширует данные в куче JVM — она пишет в файлы, и ОС держит свежие страницы в памяти. Consumer, который читает «с хвоста» (без большого lag), получает данные из RAM, не трогая диск. Плюс нет давления на GC и кэш не теряется при рестарте процесса брокера. Kafka по умолчанию не делает fsync на каждую запись: надёжность обеспечивается репликацией, а не синхронизацией на диск.</li>
  <li><strong>Zero-copy.</strong> При отдаче данных consumer-у брокер использует системный вызов <code>sendfile</code>: данные идут из page cache прямо в сокет, минуя копирование в пространство пользователя. Это возможно потому, что формат на диске совпадает с форматом в сети — брокер не распаковывает и не пересобирает batch. Нюанс для сильного ответа: <strong>при TLS zero-copy не работает</strong>, потому что данные надо зашифровать в user space.</li>
  <li><strong>Batching на всех уровнях.</strong> Producer копит записи в batch (<code>linger.ms</code>, <code>batch.size</code>), один сетевой запрос несёт много записей, consumer одним fetch забирает мегабайты. Накладные расходы на запрос размазываются.</li>
  <li><strong>Сжатие batch-ами end-to-end.</strong> Producer сжимает batch, брокер хранит сжатым, consumer распаковывает. Сжимать много однотипных JSON вместе намного эффективнее, чем по одному.</li>
  <li><strong>Партиционирование.</strong> Нагрузка делится между partitions и брокерами горизонтально; каждая partition — независимый лог.</li>
  <li><strong>Простая модель брокера.</strong> Брокер не отслеживает состояние доставки каждого сообщения каждому получателю (в отличие от классической очереди с ack на каждое сообщение) — consumer сам хранит один offset на partition.</li>
</ol>

<h3>Внутренние topics</h3>
<ul>
  <li><code>__consumer_offsets</code> — committed offsets consumer groups (compacted, ключ — группа+topic+partition).</li>
  <li><code>__transaction_state</code> — состояние транзакций producer-ов.</li>
  <li><code>__cluster_metadata</code> — лог метаданных в KRaft.</li>
</ul>

<h3>Что спросят на собеседовании</h3>
<ul>
  <li><strong>«Чем Kafka отличается от очереди?»</strong> — лог, сообщения не удаляются при чтении, у каждого consumer group свой offset, replay, retention; масштаб через partitions.</li>
  <li><strong>«Как гарантируется порядок?»</strong> — только внутри partition; события одной сущности кладут с одним ключом; увеличение числа partitions ломает отображение ключей.</li>
  <li><strong>«Как Kafka находит сообщение по offset?»</strong> — сегменты по base offset, разреженный индекс в mmap, короткий последовательный скан.</li>
  <li><strong>«Что такое compaction и tombstone?»</strong> — последнее значение по ключу, offsets не меняются, null value = удаление, <code>delete.retention.ms</code>.</li>
  <li><strong>«Что такое KRaft, зачем убрали ZooKeeper?»</strong> — Raft-кворум controller-ов, метаданные как лог, быстрый failover, масштаб; в 4.0 ZooKeeper удалён.</li>
  <li><strong>«Почему Kafka быстрая?»</strong> — последовательный I/O, page cache, zero-copy (кроме TLS), batching, сжатие, партиционирование.</li>
  <li><strong>«Может ли retention удалить непрочитанное?»</strong> — да, retention не знает о consumers; при отставании больше retention данные потеряны, сработает auto.offset.reset.</li>
</ul>
`
    },
    {
      id: 'replication',
      title: 'Репликация и надёжность',
      html: `
<h3>Leader и followers</h3>
<p>У каждой partition есть <strong>replication factor</strong> (RF) — сколько копий лога хранится на разных брокерах. Одна из реплик — <strong>leader</strong>, остальные — <strong>followers</strong>. Producer пишет только в leader. Consumer по умолчанию тоже читает из leader (с Kafka 2.4 можно читать с ближайшей реплики в той же стойке/зоне — KIP-392, настройки <code>client.rack</code> у клиента и <code>replica.selector.class</code> на брокере; это экономит межзональный трафик в облаке).</p>
<p>Followers <strong>сами тянут</strong> данные у лидера (pull), посылая ему такие же fetch-запросы, как consumer. В fetch-запросе follower сообщает, с какого offset он хочет читать — тем самым лидер узнаёт, докуда follower уже дошёл.</p>
<p>Лидеров распределяют по брокерам равномерно: при RF=3 и шести брокерах каждый брокер — лидер для части partitions и follower для других. Первая реплика в списке — <strong>preferred leader</strong>; после падения и возвращения брокера кластер со временем возвращает лидерство на preferred replicas (<code>auto.leader.rebalance.enable</code>), чтобы нагрузка не перекосилась.</p>

<h3>ISR — in-sync replicas</h3>
<p><strong>ISR</strong> — множество реплик, которые «успевают» за лидером. Лидер всегда в ISR. Follower исключается из ISR, если он не догонял конец лога лидера дольше, чем <code>replica.lag.time.max.ms</code> (в современных версиях по умолчанию 30 секунд). Важно: критерий — <strong>время</strong>, а не число отстающих сообщений (старый параметр по количеству сообщений давно удалён, потому что при всплеске трафика все followers ложно «выпадали»). Когда follower догоняет лидера, его возвращают в ISR. Изменения ISR лидер сообщает controller-у, и они попадают в метаданные кластера.</p>
<p>Почему ISR так важен: <strong>новым лидером при падении текущего может стать только реплика из ISR</strong> (если не включён unclean leader election). ISR — это множество реплик, у которых гарантированно есть все подтверждённые записи.</p>

<h3>LEO и high watermark</h3>
<ul>
  <li><strong>LEO (log end offset)</strong> — offset, следующий за последней записью в логе конкретной реплики. У лидера и у каждого follower свой LEO.</li>
  <li><strong>High watermark (HW)</strong> — наибольший offset, до которого запись есть на всех репликах ISR. Лидер вычисляет его как минимум LEO по ISR и сообщает followers в ответах на fetch.</li>
</ul>
<p><strong>Consumers видят только записи ниже high watermark.</strong> Запись, которая есть на лидере, но ещё не реплицирована на весь ISR, consumer не получит. Смысл: если лидер упадёт, новая лидер-реплика из ISR может не иметь этой записи — и тогда consumer прочитал бы то, чего «не было». HW гарантирует, что прочитанное не исчезнет при failover.</p>
<p>Для транзакций есть ещё <strong>LSO (last stable offset)</strong>: consumer с <code>isolation.level=read_committed</code> читает только до первого offset незавершённой транзакции.</p>
<p>При смене лидера followers <strong>обрезают</strong> (truncate) свой лог до точки, согласованной с новым лидером. Чтобы обрезка была корректной даже при каскадных сбоях, Kafka использует <strong>leader epoch</strong> (KIP-101): номер «эпохи» лидерства, записанный в каждый batch. Follower спрашивает нового лидера «где закончилась эпоха N» и обрезает лог ровно туда. Раньше обрезали по HW, и это приводило к редким расхождениям реплик и потере данных.</p>

<h3>acks: что значит «записано»</h3>
<p>Producer сам выбирает, какое подтверждение ждать от брокера, — параметр <code>acks</code>:</p>
<table>
<thead><tr><th>acks</th><th>Когда producer получает ответ</th><th>Что можно потерять</th></tr></thead>
<tbody>
<tr><td><code>0</code></td><td>Сразу после отправки, ответа от брокера нет</td><td>Всё что угодно: ошибку сети или брокера producer даже не узнает. Ретраи бессмысленны.</td></tr>
<tr><td><code>1</code></td><td>Лидер записал batch в свой лог (в page cache, не обязательно на диск)</td><td>Если лидер упадёт до того, как followers скопировали запись, новый лидер её не имеет — подтверждённая запись потеряна.</td></tr>
<tr><td><code>all</code> (= <code>-1</code>)</td><td>Запись есть на <strong>всех текущих репликах ISR</strong></td><td>Ничего, пока жив хотя бы один член ISR, — но только если ISR не «усох» до одного лидера (см. min.insync.replicas).</td></tr>
</tbody>
</table>
<p>В Java-клиенте начиная с Kafka 3.0 по умолчанию <code>acks=all</code> и включена идемпотентность. В librdkafka (а значит, в Confluent.Kafka) <code>acks</code> по умолчанию тоже <code>all</code>, а вот <code>enable.idempotence</code> по умолчанию <strong>выключен</strong> — его надо включать явно.</p>

<h3>min.insync.replicas — недостающая половина acks=all</h3>
<p>Ключевая тонкость: <code>acks=all</code> означает «все реплики <em>текущего</em> ISR», а не «все реплики». Если два follower-а отстали и выпали из ISR, ISR = {leader}, и <code>acks=all</code> фактически превращается в <code>acks=1</code>. Лидер подтвердит запись, которой нет больше ни у кого, и при его падении она исчезнет.</p>
<p>Защита — настройка topic/брокера <code>min.insync.replicas</code> (по умолчанию 1). Она говорит: «принимай запись с <code>acks=all</code>, только если в ISR сейчас не меньше N реплик». Если ISR меньше N, брокер отвечает ошибкой <code>NotEnoughReplicas</code> (или <code>NotEnoughReplicasAfterAppend</code>), и producer узнаёт, что запись не гарантирована. Запись становится недоступной, но чтение продолжает работать.</p>
<p>Канонический продакшен-конфиг для важных данных:</p>
<pre><code>replication.factor   = 3
min.insync.replicas  = 2
acks                 = all   (на producer)
unclean.leader.election.enable = false</code></pre>
<p>Что он гарантирует:</p>
<ul>
  <li>Каждая подтверждённая запись лежит как минимум на двух брокерах.</li>
  <li>Можно потерять один брокер (плановый рестарт, сбой) — запись и чтение продолжают работать, подтверждённое не теряется.</li>
  <li>Если одновременно недоступны два брокера из трёх, запись останавливается (producer получает ошибки и ретраит), но данные не теряются. Система выбирает <strong>согласованность вместо доступности</strong>.</li>
</ul>
<p>Почему не <code>min.insync.replicas=3</code> при RF=3? Тогда любой рестарт одного брокера остановит запись — никакой отказоустойчивости по доступности. Почему не RF=2, min.isr=2? Та же проблема: любой сбой блокирует запись. RF=2, min.isr=1 — сбой одного брокера в неудачный момент теряет данные. Поэтому RF=3 / min.isr=2 — стандарт. Для особо критичных систем встречают RF=5 / min.isr=3. Для логов и метрик, где потеря допустима, — RF=2 или даже <code>acks=1</code> ради latency.</p>
<blockquote><strong>Важно.</strong> <code>min.insync.replicas</code> влияет только на producer-ов с <code>acks=all</code>. Producer с <code>acks=1</code> его игнорирует. Надёжность — это всегда пара: настройка topic + настройка producer.</blockquote>

<h3>Unclean leader election</h3>
<p>Представьте: RF=3, ISR сжался до одного лидера, и лидер умер. В живых остались только реплики, которые не в ISR (отстали). Два варианта:</p>
<ul>
  <li><code>unclean.leader.election.enable=false</code> (по умолчанию с 0.11): partition остаётся без лидера и недоступна, пока не вернётся реплика из ISR. Данные целы, доступность потеряна.</li>
  <li><code>true</code>: лидером становится отставшая реплика. Partition снова доступна, но все записи, которых у неё не было, <strong>потеряны</strong>, а когда старый лидер вернётся, он обрежет свой лог под нового лидера. Ещё хуже — consumers могли уже прочитать эти записи, а offsets будут переиспользованы новыми данными.</li>
</ul>
<p>Включают unclean election только там, где доступность важнее данных (метрики, логи). Для бизнес-событий — никогда. Включить его можно и разово, вручную, как осознанное решение при аварии.</p>

<h3>Rack awareness</h3>
<p>Если все три реплики лежат в одной стойке или зоне доступности, падение зоны уносит все копии. Параметр брокера <code>broker.rack</code> заставляет Kafka раскладывать реплики partition по разным стойкам/зонам. В облаке rack = availability zone. Это бесплатная страховка от коррелированного сбоя.</p>

<h3>Где на самом деле теряются данные</h3>
<p>На собеседовании ценят, когда кандидат перечисляет реальные сценарии потери не только в брокере, но и в клиентах:</p>
<ol>
  <li><strong>acks=0 или acks=1</strong> и падение лидера до репликации.</li>
  <li><strong>acks=all, но min.insync.replicas=1</strong>: ISR сжался до лидера, лидер упал.</li>
  <li><strong>Unclean leader election</strong> включён.</li>
  <li><strong>RF=1</strong>: умер диск — данных нет.</li>
  <li><strong>Коррелированный сбой питания</strong> всех реплик: Kafka не делает fsync на каждую запись, данные в page cache всех брокеров пропадают одновременно. Лечится разнесением по зонам, а не fsync.</li>
  <li><strong>Producer не обрабатывает ошибки</strong>: fire-and-forget без проверки delivery report, исключение в callback проглочено, процесс завершился без <code>Flush</code> — сообщения из локального буфера producer-а не ушли.</li>
  <li><strong>Таймаут доставки</strong>: librdkafka держит сообщение в буфере не дольше <code>message.timeout.ms</code> (по умолчанию 5 минут). Если кластер недоступен дольше, сообщение отбрасывается с ошибкой в delivery report — и если отчёт не обработан, это тихая потеря.</li>
  <li><strong>Consumer коммитит раньше обработки</strong> (автокоммит в librdkafka с автоматическим offset store) и падает: сообщение считается прочитанным.</li>
  <li><strong>Retention</strong> удалил данные, которые consumer не успел прочитать; <strong>compaction</strong> убрал промежуточные значения, которые кому-то были нужны.</li>
  <li><strong>auto.offset.reset=latest</strong> у новой группы или группы, у которой истекли offsets (<code>offsets.retention.minutes</code>, по умолчанию 7 дней): consumer начнёт с конца и пропустит всё, что было.</li>
</ol>

<h3>Доступность против согласованности: как отвечать</h3>
<p>Kafka даёт ручки на обе стороны, и правильный ответ — «зависит от данных». Для платежей и заказов: RF=3, min.isr=2, acks=all, idempotence, unclean election off, rack awareness, мониторинг under-replicated partitions (<code>UnderReplicatedPartitions</code>, <code>UnderMinIsrPartitionCount</code>, <code>OfflinePartitionsCount</code>). Для телеметрии: acks=1, RF=2, можно unclean election — потеря нескольких точек допустима, задержка важнее.</p>

<h3>Что спросят на собеседовании</h3>
<ul>
  <li><strong>«Что такое ISR и как реплика из него выпадает?»</strong> — реплики, догоняющие лидера; критерий — время отставания (<code>replica.lag.time.max.ms</code>), не число сообщений; лидером может стать только член ISR.</li>
  <li><strong>«Что такое high watermark?»</strong> — offset, реплицированный на весь ISR; consumers читают только ниже него, чтобы прочитанное не исчезло при failover.</li>
  <li><strong>«acks=all гарантирует, что данные не потеряются?»</strong> — нет, только вместе с <code>min.insync.replicas</code> ≥ 2; иначе ISR может сжаться до лидера.</li>
  <li><strong>«RF=3, min.isr=2: что будет при падении одного брокера? Двух?»</strong> — одного: всё работает; двух: запись с acks=all отклоняется (NotEnoughReplicas), чтение работает, потерь нет.</li>
  <li><strong>«Что такое unclean leader election?»</strong> — выбор лидера вне ISR, доступность ценой потери данных; по умолчанию выключен.</li>
  <li><strong>«Kafka делает fsync?»</strong> — по умолчанию нет на каждую запись; надёжность — через репликацию, поэтому важно разносить реплики по зонам.</li>
  <li><strong>«Где ещё можно потерять сообщения, кроме брокера?»</strong> — необработанные delivery reports, отсутствие Flush, message.timeout, коммит до обработки, retention, auto.offset.reset=latest.</li>
</ul>
`
    },
    {
      id: 'producer',
      title: 'Producer',
      html: `
<h3>Что происходит при Produce</h3>
<p>Вызов <code>Produce</code> или <code>ProduceAsync</code> в Confluent.Kafka не отправляет сообщение в сеть немедленно. Путь такой:</p>
<ol>
  <li>Key и value сериализуются в байты (сериализаторы задаются в <code>ProducerBuilder</code>).</li>
  <li><strong>Partitioner</strong> выбирает partition (если вы не указали её явно).</li>
  <li>Сообщение кладётся в <strong>локальную очередь librdkafka</strong> — в batch для этой partition.</li>
  <li>Фоновый поток librdkafka отправляет batch-и брокерам-лидерам, когда batch заполнился или истекло время ожидания.</li>
  <li>Брокер отвечает в соответствии с <code>acks</code>; librdkafka при ретраибельной ошибке повторяет отправку сам.</li>
  <li>По итогу (успех или окончательная ошибка) генерируется <strong>delivery report</strong>: завершается <code>Task</code> у <code>ProduceAsync</code> или вызывается callback у <code>Produce</code>.</li>
</ol>
<p>Понимание этой асинхронности — основа всех вопросов про producer: где копятся сообщения, что будет при падении процесса, почему важен <code>Flush</code>.</p>

<h3>Batching: linger.ms и batch.size</h3>
<ul>
  <li><code>linger.ms</code> — сколько ждать, чтобы набрать batch, прежде чем отправить. Чем больше, тем крупнее batch-и и выше throughput, но выше latency. В librdkafka по умолчанию 5 мс (синоним <code>queue.buffering.max.ms</code>); в Java-клиенте значение по умолчанию в Kafka 4.0 подняли с 0 до 5 мс.</li>
  <li><code>batch.size</code> — максимальный размер batch в байтах на partition. Batch уходит, когда он заполнен, даже если linger ещё не истёк. В librdkafka есть ещё <code>batch.num.messages</code> — лимит по количеству. Значения по умолчанию в librdkafka и Java различаются, поэтому их стоит проверять для своей версии, а не заучивать.</li>
  <li>Общий объём буфера ограничивают <code>queue.buffering.max.messages</code> и <code>queue.buffering.max.kbytes</code>. Когда буфер полон, <code>Produce</code> бросает исключение с кодом <code>Local_QueueFull</code> — это сигнал backpressure: брокер не успевает или недоступен.</li>
</ul>
<p>Практика: для сервиса, который шлёт сотни тысяч событий в секунду, увеличивают <code>linger.ms</code> до 10–50 мс и включают сжатие — это может в разы снизить нагрузку на брокеры и сеть. Для latency-чувствительного запроса оставляют маленький linger.</p>

<h3>Сжатие</h3>
<p><code>compression.type</code>: <code>none</code>, <code>gzip</code>, <code>snappy</code>, <code>lz4</code>, <code>zstd</code>. Сжимается batch целиком, поэтому сжатие тем эффективнее, чем крупнее batch — batching и сжатие работают вместе. Практичные выборы: <code>lz4</code> (быстро, умеренная степень), <code>zstd</code> (лучшая степень при хорошей скорости), <code>gzip</code> — дорого по CPU. На topic есть своя настройка <code>compression.type</code>; значение <code>producer</code> (по умолчанию) значит «храни, как прислал producer». Если на topic задан другой кодек, брокеру придётся перепаковывать batch-и — лишний CPU.</p>

<h3>Ключи и partitioner</h3>
<p>Если у сообщения есть key, partition = hash(key) mod число partitions. Все сообщения с одинаковым ключом попадают в одну partition и читаются в порядке записи. Если key = null, сообщения распределяются по partitions (в современных клиентах — «липко»: пачкой в одну partition, потом в другую, чтобы batch-и были крупнее).</p>
<blockquote><strong>Подвох .NET ↔ Java.</strong> Partitioner по умолчанию в Java-клиенте — murmur2, а в librdkafka — <code>consistent_random</code> (CRC32 для ключа). Одинаковый ключ из .NET-сервиса и из Java-сервиса окажется <strong>в разных partitions</strong>. Если в один topic пишут сервисы на разных языках и важен порядок по ключу, в Confluent.Kafka ставят <code>Partitioner = Partitioner.Murmur2Random</code> — тогда распределение совпадёт с Java.</blockquote>
<p>Перекос (skew): если один ключ очень «горячий» (крупный продавец, системный аккаунт), его partition перегружена, а consumer этой partition отстаёт. Лечат составным ключом (если порядок нужен в меньшем масштабе), отдельным topic для горячих ключей или пересмотром того, что вообще должно быть упорядочено.</p>

<h3>Порядок, ретраи и max.in.flight</h3>
<p>Producer может держать несколько неподтверждённых запросов к одному брокеру одновременно — <code>max.in.flight.requests.per.connection</code> (по умолчанию 5 в Java, в librdkafka <code>max.in.flight</code> по умолчанию значительно больше). Без идемпотентности это ломает порядок: batch 1 получил временную ошибку, batch 2 записался успешно, batch 1 повторён и записан после batch 2. Порядок в partition — 2, 1.</p>
<p>Ретраи порождают и вторую проблему — <strong>дубликаты</strong>. Брокер записал batch, но ответ потерялся в сети (таймаут). Producer считает, что запись не удалась, и повторяет — в логе два одинаковых batch-а.</p>
<p>Исторически порядок спасали <code>max.in.flight=1</code> ценой throughput. Современный ответ — идемпотентный producer.</p>

<h3>Идемпотентный producer</h3>
<p>При <code>enable.idempotence=true</code>:</p>
<ul>
  <li>Producer при старте получает от брокера <strong>PID</strong> (producer id) и <strong>epoch</strong>.</li>
  <li>Каждый batch для каждой partition получает <strong>sequence number</strong>, растущий на 1.</li>
  <li>Брокер хранит для каждой пары (PID, partition) последние принятые sequence (состояние нескольких последних batch-ей). Batch с уже виденным sequence — дубликат: брокер не пишет его повторно, но отвечает успехом. Batch с «дыркой» в sequence отвергается как out-of-order.</li>
  <li>Порядок сохраняется при <code>max.in.flight</code> до 5 — брокер умеет держать состояние для пяти неподтверждённых batch-ей. Поэтому идемпотентность требует <code>acks=all</code>, ретраев и <code>max.in.flight ≤ 5</code>; librdkafka выставляет совместимые значения сам, а явно заданные несовместимые — отвергает при создании producer-а.</li>
</ul>
<p><strong>Чего идемпотентность не даёт:</strong> защиты от дубликатов между <em>сессиями</em> producer-а. Если процесс упал и перезапустился, он получит новый PID, и если ваше приложение повторно отправит то же событие (например, потому что не успело отметить его отправленным в outbox), брокер его не распознает. Идемпотентный producer устраняет дубликаты от <em>внутренних ретраев клиента</em>, а не от повторов на уровне бизнес-логики. Дубликаты от приложения ловят на стороне consumer-а.</p>
<p>Стоимость идемпотентности практически нулевая, поэтому в Java она по умолчанию включена с 3.0. В Confluent.Kafka её включают явно — это стоит говорить на собеседовании.</p>

<h3>Транзакции и transactional.id</h3>
<p>Транзакции позволяют <strong>атомарно</strong> записать несколько сообщений в разные partitions/topics и вместе с ними — offsets consumer group. Либо всё видно читателям с <code>read_committed</code>, либо ничего.</p>
<ul>
  <li><code>transactional.id</code> — стабильный идентификатор producer-а, который <strong>переживает рестарты</strong>. Обычно его привязывают к экземпляру приложения или к обрабатываемой partition.</li>
  <li><code>InitTransactions</code> регистрирует transactional.id у <strong>transaction coordinator</strong> (брокер, отвечающий за partition в <code>__transaction_state</code>), завершает или откатывает незаконченные транзакции предыдущей инкарнации и увеличивает epoch. Старый «зомби»-экземпляр с тем же id и меньшим epoch будет <strong>fenced</strong> — его записи брокер отвергнет. Это решает проблему двух живых экземпляров после сетевого разделения.</li>
  <li>При коммите coordinator пишет в каждую затронутую partition <strong>control marker</strong> (commit/abort). Consumers с <code>read_committed</code> не отдают приложению сообщения откатанных транзакций и не читают дальше LSO.</li>
</ul>
<pre><code>var config = new ProducerConfig
{
    BootstrapServers = "kafka:9092",
    TransactionalId = "order-enricher-" + instanceId, // стабильный id
    EnableIdempotence = true
};
using var producer = new ProducerBuilder&lt;string, string&gt;(config).Build();
producer.InitTransactions(TimeSpan.FromSeconds(30));

producer.BeginTransaction();
try
{
    producer.Produce("orders.enriched", new Message&lt;string, string&gt; { Key = key, Value = enriched });
    producer.Produce("orders.audit", new Message&lt;string, string&gt; { Key = key, Value = audit });

    // offsets входного topic фиксируются в той же транзакции
    producer.SendOffsetsToTransaction(
        new[] { new TopicPartitionOffset(result.TopicPartition, result.Offset + 1) },
        consumer.ConsumerGroupMetadata,
        TimeSpan.FromSeconds(30));

    producer.CommitTransaction();
}
catch (KafkaException)
{
    producer.AbortTransaction();
    throw; // фатальная ошибка (например, fenced) требует пересоздать producer
}</code></pre>
<p>Транзакции добавляют задержку (round-trip к coordinator, маркеры) и усложняют код, поэтому их применяют для сценария read-process-write внутри Kafka (подробно — в главе о семантиках), а не «на всякий случай».</p>

<h3>Delivery reports в Confluent.Kafka</h3>
<p>Есть два API:</p>
<pre><code>// 1. ProduceAsync: Task завершается, когда пришёл delivery report
try
{
    DeliveryResult&lt;string, string&gt; r = await producer.ProduceAsync(
        "orders.created",
        new Message&lt;string, string&gt; { Key = order.Id, Value = json },
        ct);
    // r.Status == PersistenceStatus.Persisted, r.TopicPartitionOffset
}
catch (ProduceException&lt;string, string&gt; ex)
{
    // ex.Error.Code, ex.DeliveryResult.Message — сообщение не доставлено
}

// 2. Produce с callback: без Task, дешевле при большом потоке
producer.Produce("metrics", msg, report =&gt;
{
    if (report.Error.IsError)
        logger.LogError("Delivery failed: {Reason}", report.Error.Reason);
});</code></pre>
<p>Нюансы:</p>
<ul>
  <li>Callback вызывается на фоновом потоке Confluent.Kafka, который обслуживает события librdkafka. <strong>Нельзя блокировать его</strong> долгой работой — задержатся все последующие отчёты.</li>
  <li><code>PersistenceStatus</code> бывает <code>Persisted</code>, <code>NotPersisted</code> и <code>PossiblyPersisted</code> — последнее значит «неизвестно, записалось ли» (таймаут после отправки). Для такого случая нужна идемпотентность на стороне consumer-а.</li>
  <li>При остановке сервиса вызывайте <code>producer.Flush(timeout)</code> — иначе сообщения из локального буфера пропадут. <code>Dispose</code> сам по себе не гарантирует доставку всего буфера.</li>
  <li>Producer потокобезопасен и дорог в создании (соединения, потоки librdkafka). Его делают <strong>singleton</strong> на приложение, а не создают на каждый запрос.</li>
</ul>

<h3>Синхронно или асинхронно</h3>
<p>Частая ошибка — цикл с <code>await ProduceAsync</code> на каждое сообщение при массовой отправке:</p>
<pre><code>foreach (var e in events)
    await producer.ProduceAsync(topic, ToMessage(e)); // по одному: throughput ~ 1 / (RTT + linger)</code></pre>
<p>Каждое сообщение ждёт подтверждения перед отправкой следующего, batch-и состоят из одного сообщения, throughput упирается в сетевую задержку. Варианты лучше:</p>
<ul>
  <li>Запустить все <code>ProduceAsync</code>, собрать задачи и дождаться <code>Task.WhenAll</code> (ограничивая размер пачки).</li>
  <li>Использовать <code>Produce</code> с callback и в конце <code>Flush</code>.</li>
</ul>
<p>При этом в HTTP-обработчике, где каждый запрос шлёт одно событие, <code>await ProduceAsync</code> — нормальный выбор: запросы идут параллельно, и librdkafka всё равно собирает их сообщения в общие batch-и. А ждать подтверждения в обработчике правильно, если клиенту надо ответить «принято» только после надёжной записи.</p>
<p>Фундаментальный компромисс: ждём подтверждение — знаем, что записано, но платим latency; не ждём — быстро, но обязаны обрабатывать отчёты асинхронно и решать, что делать с недоставленным. Для бизнес-событий, где нельзя потерять, — либо ждём, либо используем Transactional Outbox, и тогда подтверждение управляет пометкой «отправлено» в таблице.</p>

<h3>Ещё важные настройки</h3>
<ul>
  <li><code>message.timeout.ms</code> (в Java — <code>delivery.timeout.ms</code>): общий бюджет на доставку с ретраями. По его истечении — окончательная ошибка в delivery report.</li>
  <li><code>retry.backoff.ms</code>, <code>message.send.max.retries</code>: интервал и число повторов; при идемпотентности ретраи безопасны, их число обычно оставляют большим и ограничивают доставку именно таймаутом.</li>
  <li><code>message.max.bytes</code> на клиенте и <code>max.message.bytes</code> на topic: по умолчанию около мегабайта. Большие payload-ы (файлы, документы) в Kafka не кладут — кладут ссылку на объектное хранилище (claim check).</li>
</ul>

<h3>Что спросят на собеседовании</h3>
<ul>
  <li><strong>«Как producer обеспечивает высокий throughput?»</strong> — batching (linger.ms, batch.size), сжатие batch-ей, асинхронная отправка, несколько in-flight запросов.</li>
  <li><strong>«Как выбирается partition?»</strong> — hash ключа; null — распределение; различие murmur2 (Java) и consistent_random (librdkafka).</li>
  <li><strong>«Откуда дубликаты при ретраях и как их убрать?»</strong> — потерянный ответ на успешную запись; идемпотентный producer с PID и sequence numbers.</li>
  <li><strong>«Сохраняется ли порядок при ретраях?»</strong> — без идемпотентности и с max.in.flight больше 1 — нет; с идемпотентностью — да при max.in.flight ≤ 5.</li>
  <li><strong>«Защищает ли идемпотентный producer от дубликатов после рестарта?»</strong> — нет, новый PID; нужны транзакции с transactional.id или дедупликация у consumer-а.</li>
  <li><strong>«Зачем transactional.id и что такое fencing?»</strong> — стабильный id, epoch, отсечение зомби.</li>
  <li><strong>«Что будет, если процесс завершится сразу после ProduceAsync без await?»</strong> — сообщение могло остаться в локальном буфере; нужен Flush и обработка delivery report.</li>
</ul>
`
    },
    {
      id: 'consumer',
      title: 'Consumer',
      html: `
<h3>Consumer groups</h3>
<p>Consumers с одинаковым <code>group.id</code> образуют <strong>consumer group</strong> — логически один подписчик, нагрузка которого разделена между экземплярами. Правило одно: <strong>каждая partition в группе в каждый момент назначена ровно одному consumer-у</strong>. Один consumer может читать несколько partitions.</p>
<ul>
  <li>12 partitions, 4 экземпляра — по 3 partitions на каждого.</li>
  <li>12 partitions, 12 экземпляров — по одной.</li>
  <li>12 partitions, 15 экземпляров — 3 экземпляра <strong>простаивают</strong>. Масштабировать обработку больше числа partitions добавлением подов нельзя.</li>
</ul>
<p>Разные группы читают topic независимо: сервис уведомлений и сервис аналитики — две группы, у каждой свои offsets, каждая видит все сообщения. Это и есть publish-subscribe в Kafka.</p>
<p>Для каждой группы один из брокеров — <strong>group coordinator</strong>: он отслеживает участников, запускает ребалансировку и хранит committed offsets в <code>__consumer_offsets</code>.</p>

<h3>Ребалансировка (rebalance)</h3>
<p>Rebalance — перераспределение partitions между участниками группы. Запускается, когда consumer пришёл, ушёл, перестал слать heartbeat (<code>session.timeout.ms</code>), не вызывал poll дольше <code>max.poll.interval.ms</code>, или изменилось число partitions в подписке.</p>
<p>В классическом протоколе распределение считает не брокер, а один из consumer-ов — лидер группы — по выбранной стратегии (<code>partition.assignment.strategy</code>): <code>range</code>, <code>roundrobin</code>, <code>cooperative-sticky</code>. В librdkafka по умолчанию <code>range,roundrobin</code>.</p>
<h4>Eager rebalance</h4>
<p>Стратегии <code>range</code> и <code>roundrobin</code> — eager: в начале ребалансировки <strong>все</strong> consumers отдают <strong>все</strong> свои partitions, потом получают новое распределение. На время ребалансировки группа целиком не обрабатывает ничего («stop the world»). При частых деплоях подов в Kubernetes это заметные провалы обработки и рост lag.</p>
<h4>Cooperative (incremental) rebalance</h4>
<p><code>cooperative-sticky</code> (KIP-429): consumers сохраняют свои partitions, отзываются только те, которые действительно переезжают к другому участнику. Ребалансировка идёт в два раунда: в первом определяется, что нужно отозвать, во втором отозванное назначается новым владельцам. Остальные partitions всё это время обрабатываются. «Sticky» — распределение стремится минимально меняться.</p>
<p>В Confluent.Kafka: <code>PartitionAssignmentStrategy = PartitionAssignmentStrategy.CooperativeSticky</code>. В этом режиме обработчики <code>SetPartitionsAssignedHandler</code>/<code>SetPartitionsRevokedHandler</code> получают <strong>только изменения</strong> (добавленные или отозванные partitions), а не полный список. Нельзя смешивать в одной группе eager- и cooperative-стратегии без поэтапной миграции.</p>
<h4>Static membership</h4>
<p>По умолчанию рестарт пода — это «ушёл» + «пришёл», то есть две ребалансировки. С <code>group.instance.id</code> (KIP-345) consumer получает постоянную идентичность: если он вернулся в течение <code>session.timeout.ms</code> с тем же id, coordinator отдаёт ему те же partitions без ребалансировки. В Kubernetes id берут из имени пода StatefulSet. Цена: если экземпляр действительно умер, его partitions простаивают до истечения session timeout, поэтому timeout подбирают под время рестарта.</p>
<h4>Новый протокол: KIP-848</h4>
<p>Kafka 4.0 сделала GA новый протокол consumer group (KIP-848), включаемый у клиента <code>group.protocol=consumer</code>. Главное отличие: распределение считает <strong>брокер</strong> (server-side assignor), а не лидер-consumer; ребалансировка инкрементальная по своей природе и не требует глобального барьера синхронизации всей группы — каждый участник через heartbeat узнаёт свою целевую раздачу и сходится к ней независимо. Это сильно уменьшает паузы в больших группах. В librdkafka/Confluent.Kafka он сначала был early access/preview, а production-ready стал в версии 2.12; по умолчанию не включён (нужно явно задать <code>group.protocol=consumer</code>), содержит несколько изменений контракта и требует брокер 4.0+. Классический протокол (<code>group.protocol=classic</code>) продолжает работать.</p>

<h3>Heartbeat, session.timeout и max.poll.interval</h3>
<p>Два разных механизма определения «живости»:</p>
<ul>
  <li><strong>Heartbeat</strong> шлёт фоновый поток клиента каждые <code>heartbeat.interval.ms</code> (обычно 3 с). Если coordinator не получает heartbeat дольше <code>session.timeout.ms</code> (в современных клиентах по умолчанию 45 с), consumer считается мёртвым — так ловят падение процесса или потерю сети.</li>
  <li><code>max.poll.interval.ms</code> (по умолчанию 300 000 мс = 5 минут) — максимальное время между вызовами <code>Consume</code>. Heartbeat идёт из фонового потока, поэтому «зависшее» приложение с живым процессом продолжало бы держать partitions вечно. Этот таймаут ловит именно <strong>медленную или зависшую обработку</strong>.</li>
</ul>
<p>Что происходит при превышении <code>max.poll.interval.ms</code> в librdkafka: клиент сам покидает группу, его partitions уходят другим участникам. Приложение продолжает обрабатывать сообщение, а потом его <code>Commit</code> падает с ошибкой (partitions уже не его), а <code>StoreOffset</code> для потерянных partitions не сработает. Новый владелец начнёт с последнего committed offset и обработает те же сообщения — <strong>дубликаты</strong>. Если обработка систематически дольше лимита, получается бесконечный цикл ребалансировок.</p>
<p>Лечение: делать обработку быстрее; уменьшить количество сообщений, обрабатываемых между вызовами Consume; увеличить <code>max.poll.interval.ms</code> под реальное худшее время; долгую работу выносить из consumer-а (consumer только принимает задачу, а выполняет её отдельный процесс); при временных проблемах — <code>Pause</code> partitions и продолжать вызывать <code>Consume</code>.</p>

<h3>Offsets и коммит</h3>
<p><strong>Committed offset</strong> — это «следующий offset, который группа должна прочитать», то есть offset последнего обработанного сообщения <strong>плюс один</strong>. Хранится в <code>__consumer_offsets</code>. Когда consumer получает partition (при старте или ребалансировке), он продолжает с committed offset. Если его нет (новая группа или offsets истекли), применяется <code>auto.offset.reset</code>: <code>earliest</code> — с начала доступного лога, <code>latest</code> — только новые сообщения (по умолчанию latest, что для новой группы бизнес-сервиса обычно неверно — потеряет всё, что было записано до её первого запуска).</p>
<p>В Confluent.Kafka <code>Commit(consumeResult)</code> и <code>StoreOffset(consumeResult)</code> сами прибавляют единицу. А вот перегрузки, принимающие <code>TopicPartitionOffset</code>, берут offset как есть — там +1 надо писать самому.</p>
<h4>Как устроен автокоммит в librdkafka</h4>
<p>В librdkafka два отдельных шага:</p>
<ol>
  <li><strong>Offset store</strong> — запомнить в памяти клиента «этот offset можно коммитить». При <code>enable.auto.offset.store=true</code> (по умолчанию) offset запоминается <strong>в момент, когда Consume вернул сообщение приложению</strong> — то есть до обработки.</li>
  <li><strong>Commit</strong> — отправить запомненные offsets брокеру. При <code>enable.auto.commit=true</code> (по умолчанию) фоновый поток делает это каждые <code>auto.commit.interval.ms</code> (5 с).</li>
</ol>
<p>Настройки по умолчанию дают <strong>at-most-once при падении</strong>: Consume вернул сообщение, offset запомнился, фоновый коммит отправил его, приложение упало посреди обработки — сообщение потеряно. На практике чаще бывает обратное (упали до коммита — дубликаты), но гарантии «не потеряем» нет.</p>
<h4>Рекомендуемый паттерн: ручной store, автоматический commit</h4>
<pre><code>var config = new ConsumerConfig
{
    BootstrapServers = "kafka:9092",
    GroupId = "order-validation",
    AutoOffsetReset = AutoOffsetReset.Earliest,
    EnableAutoCommit = true,        // фоновый коммит сохранённых offsets
    EnableAutoOffsetStore = false,  // но сохраняем offset сами, после обработки
    PartitionAssignmentStrategy = PartitionAssignmentStrategy.CooperativeSticky
};

using var consumer = new ConsumerBuilder&lt;string, string&gt;(config).Build();
consumer.Subscribe("orders.created");

while (!ct.IsCancellationRequested)
{
    var result = consumer.Consume(ct);
    await HandleAsync(result.Message, ct); // бизнес-обработка
    consumer.StoreOffset(result);          // теперь можно коммитить
}</code></pre>
<p>Это at-least-once без синхронного коммита на каждое сообщение: offset попадает в store только после успешной обработки, а коммитится пачкой в фоне. Падение — переобработка не более чем последних нескольких секунд. Синхронный <code>Commit</code> после каждого сообщения тоже даёт at-least-once, но это сетевой round-trip на сообщение и резкое падение throughput; его оправдано делать редко — например, раз в N сообщений или в обработчике отзыва partitions.</p>
<blockquote><strong>Важно.</strong> Offset одной partition — это одно число. Закоммитить «сообщение 105 обработано, а 103 — нет» невозможно: коммит 106 означает «всё до 105 включительно готово». Это ограничение определяет, как устроена любая параллельная обработка внутри partition.</blockquote>

<h3>Lag и его мониторинг</h3>
<p><strong>Consumer lag</strong> partition = log end offset (точнее, high watermark) − committed offset группы. Это число сообщений, которые записаны, но группой ещё не обработаны. Lag группы — сумма по partitions, но смотреть надо и на максимум по partition: одна отстающая горячая partition прячется в сумме.</p>
<ul>
  <li>CLI: <code>kafka-consumer-groups.sh --bootstrap-server ... --describe --group order-validation</code> показывает CURRENT-OFFSET, LOG-END-OFFSET, LAG и владельца каждой partition.</li>
  <li>Экспортёры в Prometheus: kafka-exporter, KMinion, Burrow (оценивает тренд, а не только число); в облачных Kafka — встроенные метрики.</li>
  <li>Со стороны клиента: статистика librdkafka (<code>statistics.interval.ms</code> + <code>SetStatisticsHandler</code>) содержит <code>consumer_lag</code> по partitions.</li>
</ul>
<p>Алертить лучше не на абсолютное число («больше 10 000»), а на <strong>рост lag во времени</strong> или на <strong>lag во времени</strong> — насколько старое самое старое необработанное сообщение. 10 000 сообщений при 50 000 в секунду — это пустяк, а 100 сообщений при одном в минуту — полтора часа задержки.</p>

<h3>Параллелизм: partitions и внутри partition</h3>
<p>Верхняя граница параллельности группы = число partitions. Если обработка упирается в I/O (походы в БД, в HTTP-сервис), одного сообщения за раз на partition может не хватить. Варианты:</p>
<ol>
  <li><strong>Больше partitions</strong> — самое простое, но только при создании topic или с осознанным принятием перемешивания ключей.</li>
  <li><strong>Batch-обработка</strong>: накопить N сообщений и обработать пачкой (один bulk insert вместо N). Порядок сохраняется, коммит — по последнему в пачке.</li>
  <li><strong>Параллельно внутри partition с сохранением порядка по ключу.</strong> Сообщения раскладываются по N внутренним очередям (например, <code>Channel&lt;T&gt;</code>) по хэшу ключа: одинаковые ключи — в одну очередь, обрабатываются последовательно; разные ключи — параллельно. Порядок по ключу сохраняется (а именно он обычно и нужен), общий порядок partition — нет.</li>
</ol>
<p>Сложность третьего варианта — <strong>коммит</strong>. Сообщения завершаются не по порядку: 101 и 103 готовы, 102 ещё обрабатывается. Коммитить можно только до первого незавершённого: нужен трекер, который по каждой partition держит множество «в работе» и коммитит минимальный незавершённый offset. Ещё нужно ограничить число сообщений в полёте (иначе память и огромные переобработки при падении), остановить и дождаться очередей при отзыве partition. Для Java есть готовый Confluent Parallel Consumer; в .NET это обычно пишут сами — и на собеседовании ценят, если вы назовёте именно проблему коммита по «водяному знаку».</p>
<pre><code>// Идея трекера: offset можно коммитить, только если всё до него завершено
sealed class PartitionTracker
{
    private readonly SortedSet&lt;long&gt; _inFlight = new();
    private long _highestSeen = -1;

    public void Started(long offset) { lock (_inFlight) { _inFlight.Add(offset); _highestSeen = offset; } }
    public void Completed(long offset) { lock (_inFlight) _inFlight.Remove(offset); }

    // offset для коммита: первый незавершённый или следующий за последним виденным
    public long CommittableOffset()
    {
        lock (_inFlight)
            return _inFlight.Count &gt; 0 ? _inFlight.Min : _highestSeen + 1;
    }
}</code></pre>

<h3>Backpressure: Pause и Resume</h3>
<p><code>consumer.Pause(partitions)</code> останавливает выдачу сообщений из этих partitions, но consumer продолжает вызывать <code>Consume</code>, поддерживает членство в группе и не нарушает <code>max.poll.interval.ms</code>. Это правильный способ сказать «у меня переполнена внутренняя очередь» или «зависимость недоступна, подожду». <code>Resume</code> возобновляет чтение. Пауза — состояние текущего назначения: partition, которую отозвали и назначили заново (при eager-ребалансировке это все partitions), снова читается. Поэтому, если пауза должна пережить ребалансировку, её восстанавливают в обработчике назначения partitions.</p>

<h3>Что спросят на собеседовании</h3>
<ul>
  <li><strong>«Что будет, если consumers в группе больше, чем partitions?»</strong> — лишние простаивают; масштаб ограничен числом partitions.</li>
  <li><strong>«Что такое rebalance, чем eager отличается от cooperative?»</strong> — stop-the-world против отзыва только переезжающих partitions; static membership убирает ребалансировки при рестарте.</li>
  <li><strong>«Чем session.timeout.ms отличается от max.poll.interval.ms?»</strong> — первый ловит мёртвый процесс (heartbeat из фонового потока), второй — зависшую или медленную обработку.</li>
  <li><strong>«Почему медленная обработка приводит к дубликатам?»</strong> — превышение max.poll.interval, consumer выкинут, partition у другого, коммит не прошёл, переобработка.</li>
  <li><strong>«Как правильно коммитить в Confluent.Kafka?»</strong> — EnableAutoOffsetStore=false + StoreOffset после обработки + автокоммит; почему настройки по умолчанию не дают at-least-once.</li>
  <li><strong>«Что такое lag, как мониторить?»</strong> — HW минус committed; рост и lag во времени; инструменты.</li>
  <li><strong>«Как распараллелить обработку внутри partition, сохранив порядок по ключу?»</strong> — шардирование по ключу во внутренние очереди, коммит минимального незавершённого offset, ограничение in-flight.</li>
</ul>
`
    },
    {
      id: 'semantics',
      title: 'Семантики доставки и Transactional Outbox',
      html: `
<h3>Три семантики — и почему важно «end to end»</h3>
<p>Семантика доставки описывает, сколько раз <strong>эффект</strong> обработки сообщения случится при сбоях. Говорить о ней имеет смысл только для всей цепочки: сервис-источник → Kafka → сервис-получатель → его база данных. Kafka может гарантировать что-то в своей части, но если ваш consumer пишет в PostgreSQL, итоговая семантика определяется тем, как вы связали offset и запись в БД.</p>
<ul>
  <li><strong>At-most-once</strong> — не больше одного раза, возможна потеря. Получается, если сначала закоммитить offset, потом обработать: упали между — сообщение пропущено. Producer с <code>acks=0</code> или без ретраев — тоже at-most-once. Подходит для метрик, логов, телеметрии.</li>
  <li><strong>At-least-once</strong> — не меньше одного раза, возможны дубликаты. Сначала обработать, потом закоммитить; producer ретраит до подтверждения. Упали после обработки, но до коммита — сообщение придёт снова. <strong>Это стандарт для бизнес-событий</strong>, при условии, что consumer идемпотентен.</li>
  <li><strong>Exactly-once</strong> — эффект ровно один раз. В распределённой системе «доставить ровно один раз» по сети невозможно в общем случае; достижимо «обработать с эффектом ровно один раз» — комбинацией at-least-once доставки и идемпотентности/атомарности на стороне получателя. Отсюда честный термин <strong>effectively-once</strong>.</li>
</ul>

<h3>Exactly-once в Kafka: что именно гарантируется</h3>
<p>Kafka EOS (с 0.11) — это три механизма вместе:</p>
<ol>
  <li><strong>Идемпотентный producer</strong> — нет дубликатов от ретраев внутри одной сессии producer-а.</li>
  <li><strong>Транзакции</strong> — атомарная запись в несколько partitions <em>и</em> коммит offsets входных topics в той же транзакции (<code>SendOffsetsToTransaction</code>).</li>
  <li><strong>read_committed</strong> у читателей — они не видят сообщений из откатанных и незавершённых транзакций.</li>
</ol>
<p>Вместе это даёт exactly-once для конвейера <strong>read-process-write внутри Kafka</strong>: прочитали из topic A, посчитали, записали в topic B и сдвинули offset A — атомарно. Если сервис упал в середине, транзакция откатится, offset не сдвинется, результат никто не увидит, а после рестарта всё повторится. Kafka Streams включает это одной настройкой <code>processing.guarantee=exactly_once_v2</code>.</p>
<blockquote><strong>Важно.</strong> Kafka-транзакции <strong>не распространяются</strong> на внешние системы. Если внутри обработки вы записали строку в PostgreSQL, отправили письмо или вызвали HTTP-API платёжного шлюза, откат Kafka-транзакции эти эффекты не отменит, а повторная обработка их продублирует. На вопрос «у нас exactly-once, потому что включили транзакции» правильная реакция — спросить, куда ещё пишет сервис.</blockquote>
<p>Для приёмника-БД exactly-once достигается иначе: <strong>хранить offset в той же БД</strong>, в той же транзакции, что и результат обработки. При назначении partition consumer читает сохранённый offset из БД и делает <code>Seek</code> на него (Kafka-коммит тогда вторичен или не используется). Результат и offset фиксируются атомарно — дубликатов нет. Это паттерн Kafka Connect sink-коннекторов с exactly-once.</p>

<h3>Идемпотентный consumer</h3>
<p>В реальности почти все системы на Kafka — at-least-once + идемпотентная обработка. Способы сделать обработку идемпотентной:</p>
<ol>
  <li><strong>Естественная идемпотентность операции.</strong> «Установить статус заказа = Paid» можно применять сколько угодно раз. «Увеличить баланс на 100» — нельзя. Проектируйте события как факты с абсолютными значениями, где возможно.</li>
  <li><strong>Уникальный бизнес-ключ в БД.</strong> Платёж с <code>payment_id</code>, уникальный индекс: повторная вставка падает на конфликте — значит, уже обработано. <code>INSERT ... ON CONFLICT DO NOTHING</code> в PostgreSQL.</li>
  <li><strong>Версионирование / оптимистичная проверка.</strong> Событие несёт версию агрегата; применяем, только если версия больше сохранённой. Это ещё и защищает от переупорядочивания.</li>
  <li><strong>Inbox-таблица (дедупликация по id сообщения).</strong> Каждое событие несёт уникальный <code>event_id</code>. В той же транзакции, что и бизнес-изменение, вставляем id в таблицу <code>inbox</code> с уникальным ключом. Если вставка не прошла — дубликат, пропускаем.</li>
</ol>
<pre><code>CREATE TABLE inbox (
    consumer     text        NOT NULL,   -- имя обработчика: одно событие могут обрабатывать разные
    message_id   uuid        NOT NULL,
    processed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, message_id)
);</code></pre>
<pre><code>await using var tx = await db.Database.BeginTransactionAsync(ct);

var inserted = await db.Database.ExecuteSqlInterpolatedAsync(
    $"INSERT INTO inbox (consumer, message_id) VALUES ({ConsumerName}, {evt.EventId}) ON CONFLICT DO NOTHING",
    ct);

if (inserted == 0)
{
    await tx.RollbackAsync(ct);   // уже обработано — просто сдвигаем offset
    return;
}

await ApplyBusinessChangeAsync(evt, ct);
await db.SaveChangesAsync(ct);
await tx.CommitAsync(ct);         // inbox и бизнес-данные — атомарно</code></pre>
<p>Ключевое — <strong>одна транзакция</strong> для записи в inbox и для бизнес-изменения. Если отметку в inbox делать отдельно (или в Redis), между двумя записями снова есть окно для сбоя. Inbox чистят по <code>processed_at</code> старше окна, в течение которого возможны дубликаты (с запасом больше retention topic, если возможен replay).</p>
<p>Если producer не кладёт <code>event_id</code>, можно дедуплицировать по координатам (topic, partition, offset) — они уникальны для записи в логе. Но это ловит только переобработку той же записи, а не дубликат, который producer записал в лог дважды; поэтому лучше id события.</p>

<h3>Проблема dual write</h3>
<p>Классическая ситуация: сервис заказов принял запрос, сохранил заказ в PostgreSQL и должен опубликовать <code>OrderCreated</code> в Kafka.</p>
<pre><code>await db.SaveChangesAsync(ct);                  // 1
await producer.ProduceAsync("orders", msg, ct); // 2</code></pre>
<p>Любой порядок ломается:</p>
<ul>
  <li>Сначала БД, потом Kafka: упали между 1 и 2 (или Kafka недоступна, или истёк таймаут) — заказ есть, события нет. Сервисы-подписчики (резервирование, уведомления) о заказе не узнают никогда.</li>
  <li>Сначала Kafka, потом БД: событие ушло, а транзакция БД откатилась — подписчики обрабатывают заказ, которого не существует.</li>
  <li>Публикация внутри открытой транзакции БД до коммита — то же самое: коммит может не пройти после отправки.</li>
</ul>
<p>Распределённой транзакции (2PC) между PostgreSQL и Kafka нет, и правильный ответ на собеседовании — не «2PC», а <strong>Transactional Outbox</strong>.</p>

<h3>Transactional Outbox</h3>
<p>Идея: вместо прямой отправки в Kafka сервис в <strong>той же локальной транзакции</strong>, что и бизнес-изменение, вставляет событие в таблицу <code>outbox</code>. Атомарность обеспечивает сама БД: либо есть и заказ, и событие, либо ничего. Отдельный процесс — <strong>relay</strong> — читает outbox и публикует в Kafka.</p>
<pre><code>CREATE TABLE outbox (
    id             bigserial   PRIMARY KEY,
    event_id       uuid        NOT NULL UNIQUE,
    aggregate_type text        NOT NULL,      -- 'order'
    aggregate_id   text        NOT NULL,      -- станет key сообщения
    event_type     text        NOT NULL,      -- 'OrderCreated'
    payload        jsonb       NOT NULL,
    headers        jsonb,                     -- trace context, correlation id
    created_at     timestamptz NOT NULL DEFAULT now(),
    published_at   timestamptz
);
CREATE INDEX ix_outbox_unpublished ON outbox (id) WHERE published_at IS NULL;</code></pre>
<pre><code>// в обработчике команды — одна транзакция
db.Orders.Add(order);
db.Outbox.Add(OutboxMessage.From(new OrderCreated(order.Id, order.Total), order.Id));
await db.SaveChangesAsync(ct); // SaveChanges сам оборачивает всё в транзакцию</code></pre>
<h4>Relay через polling</h4>
<p>Фоновый сервис раз в N сотен миллисекунд выбирает неопубликованные записи по порядку, отправляет их в Kafka, дожидается подтверждений и помечает <code>published_at</code> (или удаляет).</p>
<pre><code>SELECT id, event_id, aggregate_id, event_type, payload, headers
FROM outbox
WHERE published_at IS NULL
ORDER BY id
LIMIT 500
FOR UPDATE SKIP LOCKED;</code></pre>
<p>Свойства и подводные камни:</p>
<ul>
  <li><strong>At-least-once.</strong> Relay отправил, Kafka подтвердила, relay упал до UPDATE — после рестарта отправит снова. Поэтому consumers обязаны быть идемпотентными, а <code>event_id</code> в событии — для их inbox.</li>
  <li><strong>Порядок.</strong> Порядок по агрегату сохраняется, если relay отправляет записи по возрастанию id, с ключом = <code>aggregate_id</code>, с идемпотентным producer-ом, и помечает опубликованным только после подтверждения. Несколько параллельных relay с <code>SKIP LOCKED</code> масштабируют пропускную способность, но <strong>ломают порядок</strong>: два события одного заказа могут уйти из разных экземпляров в обратном порядке. Варианты: один активный relay (лидер через advisory lock), или шардирование relay по хэшу aggregate_id.</li>
  <li><strong>Ловушка «курсора по id».</strong> Если relay запоминает «последний опубликованный id» и читает <code>WHERE id &gt; last</code>, он может пропустить строку: транзакция, получившая id 100, закоммитилась позже транзакции с id 101. Relay увидел 101, сдвинул курсор, а 100 появилась после. Поэтому выбирают по флагу <code>published_at IS NULL</code>, а не по курсору.</li>
  <li><strong>Нагрузка и задержка.</strong> Polling — это постоянные запросы к БД и задержка до интервала опроса. Обычно приемлемо (сотни миллисекунд). Частичный индекс по неопубликованным держит запрос дешёвым.</li>
  <li><strong>Очистка.</strong> Опубликованные строки удаляют фоновой задачей (или сразу), иначе таблица растёт без предела. Для больших объёмов — партиционирование таблицы по дате и удаление партиций целиком.</li>
</ul>
<h4>Relay через CDC (Debezium)</h4>
<p>Change Data Capture: Debezium читает журнал транзакций БД (WAL в PostgreSQL через logical replication, binlog в MySQL) и превращает вставки в outbox в сообщения Kafka. Для этого есть готовый <strong>Outbox Event Router</strong> (SMT): он берёт из строки outbox тип агрегата (→ имя topic), id агрегата (→ key), payload и заголовки.</p>
<ul>
  <li>Плюсы: нет polling-нагрузки, низкая задержка, порядок совпадает с порядком коммитов в журнале, приложению не нужен relay-код.</li>
  <li>Можно вставлять в outbox и <strong>сразу удалять</strong> в той же транзакции: вставка уже попала в WAL, Debezium её увидит, а таблица остаётся пустой. Очистка не нужна.</li>
  <li>Минусы: инфраструктура (Kafka Connect, Debezium, replication slot), эксплуатация. Неактивный replication slot в PostgreSQL удерживает WAL, и диск БД может переполниться — это реальная авария, слот нужно мониторить.</li>
  <li>Debezium тоже at-least-once (после рестарта может повторить события с последней сохранённой позиции).</li>
</ul>
<h4>Outbox для событий из consumer-а</h4>
<p>Если consumer, обработав событие, должен изменить свою БД <em>и</em> опубликовать новое событие, используют обе таблицы в одной транзакции: inbox (дедупликация входящего) + бизнес-изменение + outbox (исходящее). Это даёт effectively-once на всей цепочке с Kafka и БД.</p>

<h3>Почему не «просто ретраить отправку»</h3>
<p>Ретраи <code>ProduceAsync</code> внутри HTTP-запроса не спасают от падения процесса: если под убит (OOM, деплой) между коммитом БД и успешной отправкой, ретраить некому. Outbox переносит «обещание отправить» в надёжное хранилище, и relay выполнит его даже после перезапуска.</p>

<h3>Что спросят на собеседовании</h3>
<ul>
  <li><strong>«Какие семантики доставки бывают, что у вас было?»</strong> — определения через порядок «обработка/коммит»; at-least-once + идемпотентность как стандарт.</li>
  <li><strong>«Kafka умеет exactly-once?»</strong> — да, для read-process-write внутри Kafka (идемпотентность + транзакции + read_committed); на внешние системы не распространяется.</li>
  <li><strong>«Как сделать consumer идемпотентным?»</strong> — inbox в той же транзакции, уникальные бизнес-ключи, версии, абсолютные значения.</li>
  <li><strong>«Как не потерять событие при записи в БД и Kafka?»</strong> — dual write не решается порядком вызовов; Transactional Outbox; polling vs CDC.</li>
  <li><strong>«Как outbox сохраняет порядок?»</strong> — key = aggregate id, отправка по возрастанию, один relay или шардирование, пометка после подтверждения; проблема параллельных relay.</li>
  <li><strong>«Какие проблемы у outbox?»</strong> — дубликаты (at-least-once), рост таблицы, задержка polling, курсор по id, replication slot у Debezium.</li>
</ul>
`
    },
    {
      id: 'errors',
      title: 'Ошибки, ретраи, DLQ и replay',
      html: `
<h3>Сначала классифицировать ошибку</h3>
<p>Всё проектирование обработки ошибок начинается с вопроса: <strong>поможет ли повтор?</strong></p>
<ul>
  <li><strong>Временные (transient)</strong>: таймаут БД, недоступен соседний сервис, deadlock, 503, rate limit. Повтор через какое-то время скорее всего пройдёт.</li>
  <li><strong>Постоянные (permanent)</strong>: невалидный JSON, отсутствует обязательное поле, нарушено бизнес-правило («заказ уже отменён»), баг в коде обработчика на конкретных данных. Сколько ни повторяй — результат тот же.</li>
</ul>
<p>Сообщение, которое стабильно роняет обработку, называют <strong>poison message</strong> (poison pill). Самый опасный сценарий с ним: обработчик бросает исключение, offset не сдвигается, consumer перечитывает то же сообщение, снова падает — <strong>partition остановлена навсегда</strong>, lag растёт, все следующие сообщения этой partition ждут. Если исключение роняет весь процесс, под уходит в CrashLoopBackOff, а partition переходит к другому экземпляру, который тоже падает.</p>

<h3>Почему блокирующие ретраи останавливают partition</h3>
<p>Обработка в partition последовательна. Если на сообщении 500 вы делаете ретраи с backoff (1 с, 5 с, 30 с, 2 мин…) прямо в цикле consumer-а, сообщения 501, 502, … всё это время не обрабатываются, даже если с ними всё в порядке. Плюс риск превысить <code>max.poll.interval.ms</code>, вылететь из группы и получить ребалансировку с переобработкой.</p>
<p>Но блокирующий ретрай <strong>не всегда плох</strong>:</p>
<ul>
  <li>Если ошибка касается <strong>всех</strong> сообщений (упала БД, на которую пишет обработчик), обрабатывать следующие бессмысленно — они упадут так же. Правильно приостановиться и ждать: <code>Pause</code> partitions, ретраить с backoff, продолжая вызывать <code>Consume</code>, или circuit breaker. Перекладывать миллион сообщений в retry topic при недоступной БД — хуже.</li>
  <li>Если строгий порядок важнее задержки (события одного счёта), пропускать сообщение вперёд нельзя — придётся ждать или парковать весь ключ.</li>
</ul>
<p>Короткие блокирующие ретраи (2–3 попытки за секунды) для сетевых сбоев — нормальная практика. Длинные — через неблокирующие механизмы.</p>

<h3>Неблокирующие ретраи: retry topics</h3>
<p>Паттерн: при ошибке сообщение не ретраится на месте, а <strong>публикуется в отдельный topic</strong> с задержкой, а offset исходного сообщения сдвигается — partition продолжает работу.</p>
<pre><code>orders.created                    основной topic
orders.created.retry.10s          первая повторная попытка через 10 с
orders.created.retry.1m           вторая — через минуту
orders.created.retry.10m          третья — через 10 минут
orders.created.dlq                окончательно не обработано</code></pre>
<p>В заголовки кладут метаданные: число попыток, исходный topic/partition/offset, время первой ошибки, текст исключения, «не раньше чем» (время, когда повторять). Retry-consumer читает свой topic и, если время ещё не пришло, <strong>не спит</strong> в обработчике (это снова нарушит <code>max.poll.interval.ms</code>), а ставит partition на <code>Pause</code> и возобновляет её по таймеру, или делает <code>Seek</code> на то же сообщение после паузы. Так как сообщения в retry topic пишутся по времени, если первое ещё не созрело, следующие тоже не созрели — одна пауза на всю partition корректна.</p>
<pre><code>var dueAt = ReadDueAt(result.Message.Headers);
var wait = dueAt - DateTimeOffset.UtcNow;
if (wait &gt; TimeSpan.Zero)
{
    consumer.Pause(new[] { result.TopicPartition });
    consumer.Seek(result.TopicPartitionOffset);      // перечитаем это же сообщение
    ScheduleResume(result.TopicPartition, wait);     // таймер -&gt; Resume
    continue;                                        // продолжаем крутить Consume
}</code></pre>
<p>Цена неблокирующих ретраев — <strong>потеря порядка</strong>: сообщение 500 обработается после 501–600. Для событий, где это важно (обновления состояния одного заказа), применяют <strong>парковку ключа</strong>: если по ключу есть сообщение в retry, следующие сообщения того же ключа тоже отправляются в retry (или в «ожидание»), пока первое не разрешится. Для этого нужно хранилище «ключи в ретрае». Альтернатива — версии в событиях: потребитель игнорирует устаревшие версии, и порядок перестаёт быть критичным.</p>

<h3>DLQ — dead letter queue</h3>
<p>Сообщение, исчерпавшее ретраи, или ошибка, которую ретраить бессмысленно (невалидные данные), уходит в <strong>DLQ topic</strong>. Принципы:</p>
<ul>
  <li>Постоянные ошибки — сразу в DLQ, минуя ретраи.</li>
  <li>DLQ — это не мусорка, а очередь на разбор: на её размер ставят алерт, у неё есть владелец.</li>
  <li>Сохраняйте <strong>исходные байты</strong> (а не пересериализованный объект) и диагностику в заголовках: исходные координаты, тип и текст исключения, версию сервиса, время.</li>
  <li>Нужен способ <strong>переотправки</strong> из DLQ в основной topic (или retry) после исправления бага — утилита или админ-эндпоинт. Порядок при этом, конечно, нарушится, и обработчики должны это пережить.</li>
  <li>Сама отправка в DLQ может упасть (Kafka недоступна) — тогда offset исходного сообщения нельзя сдвигать, иначе сообщение потеряется.</li>
</ul>

<h3>Ошибки десериализации</h3>
<p>Особый вид poison message: байты не парсятся (другой формат, старая или новая схема, мусор). Если десериализатор задан в <code>ConsumerBuilder</code>, Confluent.Kafka бросает <code>ConsumeException</code> из самого <code>Consume</code> с кодом <code>ErrorCode.Local_ValueDeserialization</code> (или <code>Local_KeyDeserialization</code>). Сырые байты и координаты доступны через <code>ex.ConsumerRecord</code>. Если это исключение не обработать, цикл упадёт и при рестарте снова прочитает то же сообщение.</p>
<pre><code>try
{
    var result = consumer.Consume(ct);
    await HandleAsync(result, ct);
    consumer.StoreOffset(result);
}
catch (ConsumeException ex) when (ex.Error.Code is ErrorCode.Local_ValueDeserialization
                                               or ErrorCode.Local_KeyDeserialization)
{
    var raw = ex.ConsumerRecord;               // байты и TopicPartitionOffset
    await deadLetters.SendAsync(raw, ex, ct);  // в DLQ с исходными байтами
    consumer.StoreOffset(new TopicPartitionOffset(
        raw.TopicPartition, raw.Offset + 1));  // TopicPartitionOffset: +1 вручную
}</code></pre>
<p>Альтернатива, которую часто выбирают: читать <code>IConsumer&lt;string, byte[]&gt;</code> и десериализовать в своём коде — тогда ошибка парсинга — обычное исключение в обработчике, и для неё работает общий механизм DLQ.</p>

<h3>Компенсации</h3>
<p>В асинхронной системе нет распределённого отката. Если шаг процесса не удался после того, как предыдущие шаги уже выполнены в других сервисах, их отменяют <strong>компенсирующими действиями</strong> — это паттерн <strong>Saga</strong>. Пример: заказ создан, сервис склада зарезервировал товар (<code>StockReserved</code>), а сервис валидации отклонил заказ (<code>OrderRejected</code>). Склад, получив <code>OrderRejected</code>, снимает резерв — компенсация. Компенсация — это тоже бизнес-операция с собственными событиями, она должна быть идемпотентной и не всегда возвращает мир в точности к исходному состоянию (отправленное письмо не «отменишь» — отправят второе с извинениями).</p>
<p>Оркестрация (центральный координатор саги, который шлёт команды и слушает ответы) против хореографии (сервисы реагируют на события друг друга) — частый смежный вопрос. Хореография проще в начале, но процесс размазан по сервисам; оркестратор явно хранит состояние процесса и таймауты.</p>

<h3>Replay: перечитать с нужного места</h3>
<p>Kafka хранит историю, поэтому можно переобработать события: после бага в обработчике, для заполнения новой проекции, для восстановления после аварии.</p>
<ul>
  <li><strong>CLI</strong> (группа должна быть неактивна — все consumers остановлены):
<pre><code>kafka-consumer-groups.sh --bootstrap-server kafka:9092 --group order-projection \\
  --topic orders.created --reset-offsets --to-datetime 2026-10-20T14:00:00.000 --execute
# также --to-earliest, --to-offset N, --shift-by -1000; без --execute — dry run</code></pre></li>
  <li><strong>Из кода</strong>: <code>OffsetsForTimes</code> находит offsets по времени, затем <code>Assign</code> или <code>Seek</code> на них — например, в обработчике назначения partitions.</li>
  <li><strong>Новая группа</strong> с <code>auto.offset.reset=earliest</code> — чтобы построить проекцию с нуля, не трогая работающую.</li>
</ul>
<p>Replay безопасен только при идемпотентных обработчиках и только в пределах retention. Учитывайте побочные эффекты: переобработка событий не должна заново слать письма клиентам — такие обработчики отключают или помечают replay-режим.</p>

<h3>Не терять и не дублировать при деплое</h3>
<p>При rolling deploy под получает SIGTERM. Плохой сценарий: процесс убит посреди обработки, offset последних секунд не закоммичен (дубликаты), consumer не вышел из группы — его partitions простаивают до <code>session.timeout.ms</code> (45 с без обработки).</p>
<p>Правильное завершение:</p>
<ol>
  <li>SIGTERM → .NET host отменяет <code>stoppingToken</code> у <code>BackgroundService</code>.</li>
  <li><code>Consume(token)</code> бросает <code>OperationCanceledException</code>; цикл завершает <strong>текущее</strong> сообщение (обработку не обрывают тем же токеном, если она не идемпотентна посередине) и выходит.</li>
  <li>Сохранить offset обработанного и вызвать <code>consumer.Close()</code>: он коммитит сохранённые offsets (при включённом автокоммите), вызывает обработчик отзыва и <strong>штатно покидает группу</strong> — ребалансировка начинается сразу, без ожидания session timeout. Только <code>Dispose</code> без <code>Close</code> из группы штатно не выходит.</li>
  <li>Producer: <code>Flush</code> перед остановкой.</li>
  <li>Таймауты должны сходиться: <code>terminationGracePeriodSeconds</code> пода больше, чем <code>HostOptions.ShutdownTimeout</code> (в современных .NET по умолчанию 30 с), а тот — больше худшего времени обработки одного сообщения.</li>
</ol>
<p><strong>Commit on revoke.</strong> При ребалансировке consumer теряет partitions. В <code>SetPartitionsRevokedHandler</code> нужно дождаться завершения сообщений этих partitions в обработке и закоммитить их offsets — иначе новый владелец переобработает их. Отдельно есть <code>SetPartitionsLostHandler</code>: partitions <em>потеряны</em> (например, consumer выкинут по таймауту) и уже принадлежат другому — коммитить в нём бессмысленно и неправильно, нужно лишь остановить их обработку.</p>
<pre><code>.SetPartitionsRevokedHandler((c, revoked) =&gt;
{
    inFlight.WaitForCompletion(revoked);  // дождаться сообщений этих partitions
    c.Commit();                           // закоммитить сохранённые offsets
})
.SetPartitionsLostHandler((c, lost) =&gt;
{
    inFlight.Cancel(lost);                // уже не наши — только остановить работу
})</code></pre>

<h3>Что спросят на собеседовании</h3>
<ul>
  <li><strong>«Что такое poison message, чем он опасен?»</strong> — сообщение, которое всегда роняет обработку; блокирует partition навсегда; лечение — DLQ после классификации ошибки.</li>
  <li><strong>«Как сделать ретраи с задержкой в Kafka?»</strong> — retry topics с уровнями задержки, заголовки, Pause/Seek вместо sleep; DLQ в конце.</li>
  <li><strong>«Чем плохи блокирующие ретраи, а когда они правильны?»</strong> — стоит вся partition, риск max.poll.interval; правильно, когда недоступна общая зависимость или порядок критичен.</li>
  <li><strong>«Что теряем при неблокирующих ретраях?»</strong> — порядок; парковка ключа или версии событий.</li>
  <li><strong>«Как обработать ошибку десериализации в Confluent.Kafka?»</strong> — ConsumeException, ConsumerRecord с байтами, DLQ, сдвиг offset; или byte[] и свой парсинг.</li>
  <li><strong>«Как перечитать события за вчера?»</strong> — reset-offsets по времени при остановленной группе, OffsetsForTimes, новая группа; идемпотентность обязательна.</li>
  <li><strong>«Как не потерять и не задублировать сообщения при деплое?»</strong> — graceful shutdown, Close, commit on revoke, Flush, согласованные таймауты, static membership.</li>
</ul>
`
    },
    {
      id: 'schemas',
      title: 'Схемы, контракты и дизайн событий',
      html: `
<h3>Контракт важнее транспорта</h3>
<p>Kafka передаёт байты. Всё, что делает событие понятным для получателя, — формат сериализации, схема, правила её эволюции — это контракт между командами. В крупной компании topic читают сервисы других доменов, которые деплоятся независимо. Сломанный контракт проявляется не на ревью, а в продакшене: consumer другой команды начинает падать на десериализации, partition встаёт, lag растёт. Поэтому вопросы про схемы на собеседовании — это вопросы про то, как вы обеспечиваете независимые релизы.</p>

<h3>Форматы сериализации</h3>
<table>
<thead><tr><th></th><th>JSON</th><th>Avro</th><th>Protobuf</th></tr></thead>
<tbody>
<tr><td>Размер</td><td>Большой: имена полей в каждом сообщении (сжатие batch-ей частично компенсирует)</td><td>Компактный: только значения, без имён и тегов</td><td>Компактный: номера полей + значения</td></tr>
<tr><td>Схема</td><td>Не обязательна (можно JSON Schema)</td><td>Обязательна для чтения: без схемы писателя байты не разобрать</td><td><code>.proto</code>, код генерируется; читать можно и без схемы писателя</td></tr>
<tr><td>Эволюция</td><td>Только дисциплиной (tolerant reader)</td><td>Строгие правила, default-значения, резолюция схем писателя и читателя</td><td>По номерам полей: новые поля игнорируются старым кодом</td></tr>
<tr><td>Человекочитаемость</td><td>Да</td><td>Нет</td><td>Нет</td></tr>
<tr><td>Экосистема .NET</td><td>System.Text.Json</td><td>Apache.Avro, генерация классов</td><td>Google.Protobuf, Grpc.Tools — привычно, если уже есть gRPC</td></tr>
</tbody>
</table>
<p>Практика: JSON — когда важна простота и отладка, объёмы умеренные и есть дисциплина обратной совместимости. Avro — исторический стандарт экосистемы Confluent (Kafka Connect, ksqlDB). Protobuf — популярен в .NET и в компаниях с gRPC: одна система типов для синхронных и асинхронных контрактов, хорошая генерация кода. Главное — не формат, а наличие <strong>схемы и проверки совместимости</strong> до деплоя.</p>

<h3>Schema Registry</h3>
<p><strong>Schema Registry</strong> (Confluent, есть совместимые альтернативы, например Apicurio и Karapace) — отдельный сервис, хранящий версии схем. Как это работает с сериализатором:</p>
<ol>
  <li>Producer при первой отправке регистрирует (или находит) схему в registry под <strong>subject</strong> и получает её глобальный <strong>schema id</strong>.</li>
  <li>В каждое сообщение пишется wire format: <strong>magic byte 0 + 4 байта schema id</strong> + сериализованные данные (для Protobuf ещё индексы message-типов).</li>
  <li>Consumer видит id, один раз загружает схему из registry и кэширует её.</li>
  <li>При регистрации новой версии registry <strong>проверяет совместимость</strong> с предыдущими по настроенному режиму и отвергает несовместимую. Ломающее изменение не дойдёт до продакшена — producer упадёт при регистрации (а лучше — проверка в CI).</li>
</ol>
<p><strong>Subject naming strategy</strong> определяет, под каким именем регистрируется схема: <code>TopicNameStrategy</code> (по умолчанию, <code>orders-value</code>) — одна схема на topic; <code>RecordNameStrategy</code> — по полному имени типа, позволяет класть в один topic разные типы событий; <code>TopicRecordNameStrategy</code> — комбинация. Если в topic летят несколько типов событий одного агрегата (чтобы сохранить их общий порядок по ключу), нужна не TopicNameStrategy.</p>
<p>В продакшене авто-регистрацию схем producer-ом часто выключают (<code>AutoRegisterSchemas = false</code>), а схемы регистрирует CI-пайплайн — тогда контракт меняется осознанно.</p>
<pre><code>var schemaRegistry = new CachedSchemaRegistryClient(
    new SchemaRegistryConfig { Url = "http://schema-registry:8081" });

using var producer = new ProducerBuilder&lt;string, OrderCreated&gt;(producerConfig)
    .SetValueSerializer(new ProtobufSerializer&lt;OrderCreated&gt;(schemaRegistry))
    .Build();

using var consumer = new ConsumerBuilder&lt;string, OrderCreated&gt;(consumerConfig)
    .SetValueDeserializer(new ProtobufDeserializer&lt;OrderCreated&gt;().AsSyncOverAsync())
    .Build();</code></pre>
<p>Сериализаторы Schema Registry асинхронные (ходят в registry), поэтому для consumer-а их оборачивают <code>AsSyncOverAsync()</code> из <code>Confluent.Kafka.SyncOverAsync</code> — Consume синхронный. Пакеты: <code>Confluent.SchemaRegistry</code>, <code>Confluent.SchemaRegistry.Serdes.Protobuf</code> / <code>.Avro</code> / <code>.Json</code>.</p>

<h3>Режимы совместимости</h3>
<p>Вопрос «backward или forward» путают часто, поэтому формулируйте через то, <strong>кого обновляют первым</strong>:</p>
<table>
<thead><tr><th>Режим</th><th>Что гарантирует</th><th>Кого обновлять первым</th><th>Что можно (Avro)</th></tr></thead>
<tbody>
<tr><td><code>BACKWARD</code> (по умолчанию)</td><td>Новая схема читает данные, записанные старой</td><td>Consumers</td><td>Удалять поля; добавлять поля с default</td></tr>
<tr><td><code>FORWARD</code></td><td>Старая схема читает данные, записанные новой</td><td>Producers</td><td>Добавлять поля; удалять поля, у которых есть default</td></tr>
<tr><td><code>FULL</code></td><td>И то и другое</td><td>В любом порядке</td><td>Добавлять/удалять только поля с default</td></tr>
<tr><td><code>NONE</code></td><td>Ничего не проверяется</td><td>—</td><td>Всё (и всё ломается)</td></tr>
</tbody>
</table>
<p>Суффикс <code>_TRANSITIVE</code> (<code>BACKWARD_TRANSITIVE</code> и т.д.) означает проверку против <strong>всех</strong> предыдущих версий, а не только последней. Это важно, если в topic лежат данные многих версий (большой retention, compaction, replay): без transitive версия 3 совместима с 2, 2 — с 1, но 3 может не читать 1.</p>
<p>Почему BACKWARD по умолчанию: в Kafka старые данные лежат в логе, и новый consumer должен уметь их прочитать — в том числе при replay с начала.</p>
<h4>Правила для Protobuf</h4>
<ul>
  <li>Никогда не менять номер и тип существующего поля.</li>
  <li>Удалённое поле — объявить номер и имя <code>reserved</code>, чтобы никто не переиспользовал номер с другим смыслом.</li>
  <li>Добавление поля безопасно: старый код его проигнорирует, новый при чтении старых данных получит значение по умолчанию (в proto3 — ноль/пустую строку; если нужно отличать «не передано», используют <code>optional</code> или wrapper-типы).</li>
  <li>Переименование поля бинарно безопасно (на проводе только номер), но ломает JSON-представление и код.</li>
  <li>Для enum — нулевое значение <code>UNSPECIFIED</code>, новые значения старый код увидит как неизвестные числа: обработчик должен это переживать.</li>
</ul>
<h4>JSON без схемы</h4>
<p>Принцип <strong>tolerant reader</strong>: игнорировать неизвестные поля, не падать на отсутствии необязательных, не менять тип и смысл поля. Добавлять — можно, удалять и переименовывать — только через период, когда поле никто не читает. System.Text.Json по умолчанию игнорирует неизвестные свойства — это помогает.</p>

<h3>Ломающие изменения</h3>
<p>Если изменение несовместимо по сути (сменилась модель, поле поменяло смысл), варианты:</p>
<ol>
  <li><strong>Новый тип события</strong> (<code>OrderCreatedV2</code>) в том же topic при RecordNameStrategy; producer какое-то время пишет оба.</li>
  <li><strong>Новый topic</strong> (<code>orders.created.v2</code>), dual publish на период миграции, consumers переходят по одному, старый topic выводят из эксплуатации.</li>
  <li><strong>Upcasting</strong> на стороне consumer-а: приведение старой версии к новой модели при чтении.</li>
</ol>
<p>Во всех случаях нужен владелец контракта (обычно команда-producer) и коммуникация с потребителями.</p>

<h3>Дизайн событий</h3>
<h4>События и команды</h4>
<ul>
  <li><strong>Событие</strong> — факт, который уже произошёл: <code>OrderCreated</code>, <code>PaymentCaptured</code>. Прошедшее время. Отправитель не знает и не должен знать, кто подписан; отказаться от события получатель не может — это история. Один producer, много consumers.</li>
  <li><strong>Команда</strong> — просьба что-то сделать: <code>ValidateOrder</code>, <code>ReserveStock</code>. Повелительное наклонение. Есть конкретный адресат, который может отказать (и ответить событием <code>OrderValidationFailed</code>). Много отправителей, один получатель.</li>
</ul>
<p>Kafka подходит для обоих, но смешение понятий — частая ошибка: «событие» <code>SendEmail</code> на самом деле команда, и связывает сервисы сильнее, чем кажется.</p>
<p>Пример из практики межсервисной интеграции: сервис заказов публикует команду или событие «заказ требует проверки», сервис валидации другого домена читает его, проверяет и публикует результат в свой topic (<code>OrderValidated</code> / <code>OrderRejected</code>) с тем же ключом orderId; сервис заказов читает результат и двигает состояние заказа. Корреляция — по orderId и correlation id в заголовках, таймауты — на стороне инициатора (если ответа нет N минут — повтор или ручной разбор).</p>
<h4>Thin и fat events</h4>
<ul>
  <li><strong>Thin (notification) event</strong>: «заказ 123 изменился» — минимум данных. Потребитель идёт за деталями по API. Плюсы: маленький контракт, всегда актуальные данные. Минусы: синхронная зависимость обратно на источник (нагрузка, доступность), гонки — к моменту запроса состояние уже другое.</li>
  <li><strong>Fat event / Event-Carried State Transfer</strong>: событие несёт всё нужное состояние (заказ с позициями, суммой, адресом). Потребители автономны, могут строить свои проекции, replay восстанавливает состояние. Минусы: больший контракт, который труднее менять, утечка внутренней модели, размер сообщений.</li>
</ul>
<p>Частый компромисс — события с данными, нужными для типичных потребителей, плюс id для доп. запросов. Для compacted topics с текущим состоянием сущности естественен fat event.</p>
<h4>Именование и конверт</h4>
<ul>
  <li>Topic: доменно и предсказуемо, например <code>&lt;домен&gt;.&lt;сущность&gt;.&lt;событие&gt;</code> или <code>&lt;домен&gt;.&lt;сущность&gt;.events</code>; иногда с версией. Главное — единое соглашение в компании.</li>
  <li>Тип события: прошедшее время, термин домена (<code>OrderCancelled</code>, а не <code>OrderStatusChanged</code> со статусом внутри, если у отмены своя бизнес-семантика).</li>
  <li>Метаданные (конверт): <code>eventId</code> (для дедупликации), <code>eventType</code>, <code>occurredAt</code>, <code>version</code> схемы, <code>correlationId</code>/<code>causationId</code>, источник. Можно в заголовках Kafka, можно в теле; есть стандарт CloudEvents с привязкой к Kafka.</li>
</ul>
<h4>Дизайн ключей</h4>
<ul>
  <li>Ключ определяет partition и, значит, <strong>единицу порядка</strong>. Для событий агрегата ключ — id агрегата (orderId). Все события одного заказа — по порядку, разные заказы — параллельно.</li>
  <li>Если нужен порядок между разными типами событий одной сущности (Created → Paid → Shipped), они должны идти <strong>в один topic</strong> с одним ключом. Разные topics между собой не упорядочены.</li>
  <li>Null-ключ — только когда порядок не нужен и важна равномерность.</li>
  <li>Ключ с низкой кардинальностью (страна, статус) даёт перекос — пара partitions забиты, остальные пусты.</li>
  <li>Для compacted topic ключ — идентичность сущности, и его формат нельзя менять без потери смысла compaction.</li>
  <li>Ключ сериализуется так же стабильно, как значение: смена сериализации ключа (строка → Avro) меняет байты и hash, и порядок ломается.</li>
</ul>

<h3>Что спросят на собеседовании</h3>
<ul>
  <li><strong>«JSON, Avro или Protobuf?»</strong> — размер, обязательность схемы, эволюция, экосистема; важно наличие проверяемой схемы.</li>
  <li><strong>«Как работает Schema Registry?»</strong> — регистрация, schema id в 5-байтовом префиксе, кэш на consumer-е, проверка совместимости, subject strategies.</li>
  <li><strong>«Backward и forward compatibility — в чём разница, кого обновлять первым?»</strong> — backward: новые читают старое, сначала consumers; forward: старые читают новое, сначала producers; transitive.</li>
  <li><strong>«Как добавить обязательное поле?»</strong> — нельзя одним шагом; добавить опциональное/с default, обновить producers, потом считать обязательным у consumers; или новая версия события.</li>
  <li><strong>«Чем событие отличается от команды?»</strong> — факт против просьбы, адресат, возможность отказа, направление связности.</li>
  <li><strong>«Thin или fat events?»</strong> — автономность и replay против размера контракта и обратных запросов.</li>
  <li><strong>«Как выбрать ключ?»</strong> — единица порядка, id агрегата, кардинальность, один topic для упорядоченных событий сущности.</li>
</ul>
`
    },
    {
      id: 'dotnet',
      title: 'Kafka в .NET на практике',
      html: `
<h3>Confluent.Kafka и librdkafka</h3>
<p><strong>Confluent.Kafka</strong> — официальный .NET-клиент от Confluent. Это обёртка над <strong>librdkafka</strong> — нативной C-библиотекой, на которой построены клиенты для многих языков (Python, Go, Node). Отсюда несколько практических следствий:</p>
<ul>
  <li>Имена настроек — как в librdkafka (<code>linger.ms</code>, <code>enable.auto.offset.store</code>), а не как в Java. Не все Java-настройки существуют, и значения по умолчанию местами другие (partitioner, идемпотентность, assignor). Свойства <code>ProducerConfig</code>/<code>ConsumerConfig</code> — это типизированные обёртки над словарём строковых настроек; неизвестную типизированно настройку можно задать через <code>config.Set("ключ", "значение")</code>.</li>
  <li>Нативная библиотека поставляется в пакете <code>librdkafka.redist</code> для основных платформ. Образ alpine (musl) и некоторые архитектуры исторически доставляли проблем — проверяйте поддержку платформы.</li>
  <li>librdkafka живёт своими потоками: на каждый брокер — поток, плюс основной поток (он же обслуживает внутренние таймеры). Сеть, батчинг, ретраи, heartbeat, prefetch сообщений идут <strong>в фоне</strong>, независимо от вашего кода.</li>
  <li>Статистика, логи и ошибки приходят через обработчики: <code>SetErrorHandler</code>, <code>SetLogHandler</code>, <code>SetStatisticsHandler</code> (JSON со всеми метриками раз в <code>statistics.interval.ms</code>).</li>
</ul>
<p>Альтернатива — KafkaFlow (фреймворк поверх Confluent.Kafka с middleware, батчами, worker-ами по ключу) или MassTransit с Kafka-rider-ом. На собеседовании полезно знать, что под ними всё равно librdkafka.</p>

<h3>Модель потоков consumer-а</h3>
<p>librdkafka заранее (prefetch) забирает сообщения с брокеров во внутреннюю очередь (размер регулируют <code>queued.min.messages</code>, <code>queued.max.messages.kbytes</code>, <code>fetch.max.bytes</code>, <code>max.partition.fetch.bytes</code>). <code>Consume</code> лишь берёт следующее сообщение из этой локальной очереди — поэтому он быстрый и может вернуть сообщение без сетевого запроса.</p>
<ul>
  <li><code>Consume(CancellationToken)</code> блокирует поток, пока не придёт сообщение или не отменят токен (тогда <code>OperationCanceledException</code>). <code>Consume(TimeSpan)</code> вернёт <code>null</code> по таймауту.</li>
  <li><strong>IConsumer не потокобезопасен для параллельного Consume</strong>: один consumer — один поток, который вызывает Consume, Commit, StoreOffset, Seek, Pause. Если обработку распараллеливаете, сообщения отдаются воркерам, а offsets возвращаются в поток consumer-а (или защищаются явно).</li>
  <li>Обработчики ребалансировки (<code>SetPartitionsAssignedHandler</code> и др.) вызываются <strong>внутри</strong> вызова <code>Consume</code>, на том же потоке.</li>
  <li><code>IProducer</code> наоборот потокобезопасен: один экземпляр на приложение, его используют из всех запросов.</li>
</ul>

<h3>Хостинг в BackgroundService</h3>
<p>Ловушка: <code>Consume</code> синхронный и блокирующий. Исторически <code>BackgroundService.ExecuteAsync</code> выполнялся синхронно до первого <code>await</code> в потоке запуска хоста — блокирующий цикл Consume в начале <code>ExecuteAsync</code> не давал хосту стартовать (и, например, поднять HTTP-сервер для health checks). В новых версиях .NET это поведение изменили, но надёжный и переносимый способ — явно увести цикл в отдельный поток.</p>
<pre><code>public sealed class OrderCreatedConsumer : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger&lt;OrderCreatedConsumer&gt; _logger;
    private readonly ConsumerConfig _config;

    public OrderCreatedConsumer(IServiceScopeFactory scopes, IOptions&lt;ConsumerConfig&gt; config,
        ILogger&lt;OrderCreatedConsumer&gt; logger)
    {
        _scopes = scopes;
        _config = config.Value;
        _logger = logger;
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken) =&gt;
        Task.Factory.StartNew(() =&gt; RunAsync(stoppingToken), stoppingToken,
            TaskCreationOptions.LongRunning, TaskScheduler.Default).Unwrap();

    private async Task RunAsync(CancellationToken ct)
    {
        using var consumer = new ConsumerBuilder&lt;string, string&gt;(_config)
            .SetErrorHandler((_, e) =&gt; _logger.LogWarning("Kafka error: {Reason}", e.Reason))
            .SetPartitionsRevokedHandler((c, partitions) =&gt;
                _logger.LogInformation("Revoked: {Partitions}", partitions))
            .Build();

        consumer.Subscribe("orders.created");
        try
        {
            while (!ct.IsCancellationRequested)
            {
                ConsumeResult&lt;string, string&gt; result;
                try { result = consumer.Consume(ct); }
                catch (OperationCanceledException) { break; }

                // scope на сообщение: DbContext и прочие scoped-зависимости
                await using var scope = _scopes.CreateAsyncScope();
                var handler = scope.ServiceProvider.GetRequiredService&lt;IOrderCreatedHandler&gt;();

                // токен не передаём: начатое сообщение доделываем при остановке
                await handler.HandleAsync(result.Message, CancellationToken.None);
                consumer.StoreOffset(result);
            }
        }
        finally
        {
            consumer.Close(); // коммит сохранённых offsets и штатный выход из группы
        }
    }
}</code></pre>
<p>Моменты, которые стоит проговорить:</p>
<ul>
  <li><strong>Scope на сообщение.</strong> <code>BackgroundService</code> — singleton; <code>DbContext</code> — scoped. Внедрить DbContext в конструктор hosted service нельзя (или он станет «вечным» и раздуется трекингом). Создавайте scope на сообщение или на batch.</li>
  <li><strong>Исключение в цикле.</strong> Необработанное исключение из <code>ExecuteAsync</code> в современных .NET по умолчанию останавливает весь хост (<code>BackgroundServiceExceptionBehavior.StopHost</code>). Это часто желаемое поведение (Kubernetes перезапустит под), но тогда poison message роняет сервис по кругу — нужна обработка ошибок и DLQ внутри цикла.</li>
  <li><strong>Остановка.</strong> Токен отменяется при SIGTERM; <code>Close</code> в <code>finally</code>; время на остановку ограничено <code>HostOptions.ShutdownTimeout</code>.</li>
  <li>Producer регистрируют как singleton и при остановке приложения вызывают <code>Flush</code> (например, в <code>IHostApplicationLifetime.ApplicationStopping</code> или в <code>Dispose</code> обёртки).</li>
</ul>

<h3>Commit, StoreOffset и что выбрать</h3>
<table>
<thead><tr><th>Способ</th><th>Что делает</th><th>Когда</th></tr></thead>
<tbody>
<tr><td>Автокоммит + авто store (по умолчанию)</td><td>offset сохраняется при выдаче сообщения, коммитится в фоне</td><td>Когда допустима потеря при падении (at-most-once-подобно)</td></tr>
<tr><td>Автокоммит + <code>StoreOffset</code> вручную</td><td>offset сохраняется после обработки, коммит в фоне</td><td>Основной вариант at-least-once с хорошим throughput</td></tr>
<tr><td><code>Commit(result)</code> синхронно</td><td>Сетевой вызов, ждёт подтверждения брокера</td><td>Редко: раз в batch, перед отзывом partitions, когда нужно точно знать, что закоммичено</td></tr>
<tr><td>Offset в своей БД</td><td>Offset в одной транзакции с результатом, <code>Seek</code> при назначении</td><td>Effectively-once с БД-приёмником</td></tr>
</tbody>
</table>
<p><code>Commit</code> может бросить <code>KafkaException</code> (например, если partitions уже отозваны) — это нормальная ситуация при ребалансировке, её логируют, а не роняют сервис.</p>

<h3>Конфигурация, которая имеет значение</h3>
<table>
<thead><tr><th>Настройка</th><th>Зачем</th></tr></thead>
<tbody>
<tr><td><code>bootstrap.servers</code></td><td>Несколько адресов для начального подключения</td></tr>
<tr><td><code>client.id</code></td><td>Имя клиента в логах и метриках брокера — облегчает расследования</td></tr>
<tr><td><code>acks</code>, <code>enable.idempotence</code></td><td>Надёжность producer-а; идемпотентность в librdkafka включать явно</td></tr>
<tr><td><code>linger.ms</code>, <code>batch.size</code>, <code>compression.type</code></td><td>Throughput против latency</td></tr>
<tr><td><code>message.timeout.ms</code></td><td>Сколько сообщение может ждать доставки, прежде чем станет ошибкой</td></tr>
<tr><td><code>partitioner</code></td><td><code>murmur2_random</code> для совместимости с Java</td></tr>
<tr><td><code>group.id</code>, <code>auto.offset.reset</code></td><td>Группа и откуда начинать без committed offset (для бизнес-событий обычно earliest)</td></tr>
<tr><td><code>enable.auto.commit</code>, <code>enable.auto.offset.store</code></td><td>Семантика коммита</td></tr>
<tr><td><code>max.poll.interval.ms</code>, <code>session.timeout.ms</code></td><td>Под реальное время обработки и время рестарта</td></tr>
<tr><td><code>partition.assignment.strategy</code>, <code>group.instance.id</code></td><td>Cooperative sticky и static membership — меньше ребалансировок при деплое</td></tr>
<tr><td><code>isolation.level</code></td><td><code>read_committed</code>, если producer-ы используют транзакции (в librdkafka это значение по умолчанию)</td></tr>
<tr><td><code>security.protocol</code>, <code>sasl.*</code>, <code>ssl.*</code></td><td>Аутентификация и шифрование в продакшене</td></tr>
<tr><td><code>statistics.interval.ms</code></td><td>Включает поток статистики (lag, очереди, задержки)</td></tr>
</tbody>
</table>
<p>Конфиг удобно держать в <code>appsettings</code> и биндинговать в <code>ConsumerConfig</code>/<code>ProducerConfig</code> через <code>IOptions</code>; секреты SASL — из секретов, а не из репозитория.</p>

<h3>Тестирование</h3>
<ul>
  <li><strong>Юнит-тесты</strong>: обработчик сообщения отделён от цикла Consume (интерфейс <code>IOrderCreatedHandler</code>) и тестируется без Kafka. Цикл тонкий.</li>
  <li><strong>Интеграционные тесты с Testcontainers</strong>: пакет <code>Testcontainers.Kafka</code> поднимает настоящий брокер в Docker.</li>
</ul>
<pre><code>public sealed class KafkaFixture : IAsyncLifetime
{
    private readonly KafkaContainer _kafka = new KafkaBuilder()
        .WithImage("confluentinc/cp-kafka:7.6.1") // фиксируйте версию образа
        .Build();

    public string BootstrapServers =&gt; _kafka.GetBootstrapAddress();

    public Task InitializeAsync() =&gt; _kafka.StartAsync();
    public Task DisposeAsync() =&gt; _kafka.DisposeAsync().AsTask();
}

// в тесте: отдельный topic и group.id на тест, чтобы тесты не мешали друг другу
using var admin = new AdminClientBuilder(new AdminClientConfig { BootstrapServers = fixture.BootstrapServers }).Build();
await admin.CreateTopicsAsync(new[]
{
    new TopicSpecification { Name = topic, NumPartitions = 3, ReplicationFactor = 1 }
});</code></pre>
<p>Подводные камни интеграционных тестов: consumer получает partitions не мгновенно (ребалансировка занимает секунды) — используйте <code>auto.offset.reset=earliest</code>, чтобы не пропустить сообщения, отправленные до назначения; ждите результат с таймаутом и опросом, а не <code>Thread.Sleep</code>; уникальные имена topic и группы на тест. Для сценариев с ретраями и DLQ интеграционный тест — единственный способ проверить реальное поведение offsets. Сигнатуры <code>IAsyncLifetime</code> отличаются в xUnit v2 (Task) и v3 (ValueTask).</p>

<h3>Наблюдаемость</h3>
<h4>Метрики</h4>
<ul>
  <li>Consumer lag по partitions и lag во времени — главная метрика consumer-а.</li>
  <li>Скорость обработки, длительность обработки сообщения (гистограмма), число ошибок, число отправок в retry и DLQ.</li>
  <li>Producer: ошибки доставки, задержка до подтверждения, размер очереди librdkafka (<code>msg_cnt</code> в статистике), ретраи.</li>
  <li>Ребалансировки: частота и длительность (частые — признак проблем с max.poll.interval или нестабильных подов).</li>
</ul>
<h4>Трейсинг через заголовки</h4>
<p>Kafka разрывает синхронную цепочку вызовов, и трейс «HTTP-запрос → событие → обработка в другом сервисе» склеивается только если передать контекст в заголовках сообщения (W3C <code>traceparent</code>/<code>tracestate</code>). Для Confluent.Kafka есть пакет инструментирования в OpenTelemetry contrib, но механику полезно понимать и уметь написать вручную:</p>
<pre><code>private static readonly ActivitySource Source = new("Orders.Messaging");
private static readonly TextMapPropagator Propagator = Propagators.DefaultTextMapPropagator;

// producer
using var activity = Source.StartActivity("orders.created publish", ActivityKind.Producer);
var headers = new Headers();
Propagator.Inject(new PropagationContext(activity?.Context ?? default, Baggage.Current), headers,
    (h, key, value) =&gt; h.Add(key, Encoding.UTF8.GetBytes(value)));
await producer.ProduceAsync("orders.created",
    new Message&lt;string, string&gt; { Key = orderId, Value = json, Headers = headers }, ct);

// consumer
var parent = Propagator.Extract(default, result.Message.Headers,
    (h, key) =&gt; h.TryGetLastBytes(key, out var bytes)
        ? new[] { Encoding.UTF8.GetString(bytes) }
        : Array.Empty&lt;string&gt;());
using var processing = Source.StartActivity("orders.created process", ActivityKind.Consumer,
    parent.ActivityContext);
processing?.SetTag("messaging.system", "kafka");
processing?.SetTag("messaging.destination.name", result.Topic);</code></pre>
<p>Семантические соглашения OpenTelemetry для messaging задают имена атрибутов (<code>messaging.system</code>, <code>messaging.destination.name</code>, partition, offset, consumer group). Для batch-обработки одним span-ом сообщения разных трейсов связывают через <strong>links</strong>, а не через одного родителя. Не забудьте зарегистрировать <code>ActivitySource</code> в настройке OpenTelemetry (<code>AddSource("Orders.Messaging")</code>), иначе span-ы не будут экспортироваться. Correlation id в логах (через scope логгера) — дешёвое дополнение к трейсам.</p>

<h3>Что спросят на собеседовании</h3>
<ul>
  <li><strong>«Как устроен Confluent.Kafka?»</strong> — обёртка над librdkafka, фоновые потоки, prefetch, отличия настроек от Java.</li>
  <li><strong>«Можно ли вызывать Consume из нескольких потоков?»</strong> — нет; один поток на consumer, параллелизм — через воркеры; producer — потокобезопасный singleton.</li>
  <li><strong>«Как хостить consumer в ASP.NET Core?»</strong> — BackgroundService, отдельный long-running поток, scope на сообщение, Close в finally, обработка исключений.</li>
  <li><strong>«Commit или StoreOffset?»</strong> — StoreOffset + автокоммит как основной вариант; синхронный Commit дорог.</li>
  <li><strong>«Как тестировать?»</strong> — тонкий цикл, отдельный обработчик, Testcontainers, уникальные topics/группы, ожидание назначения.</li>
  <li><strong>«Как протянуть трейс через Kafka?»</strong> — W3C traceparent в заголовках, Inject/Extract, ActivityKind Producer/Consumer, links для batch.</li>
</ul>
`
    },
    {
      id: 'comparison',
      title: 'Kafka против RabbitMQ и других',
      html: `
<h3>Две разные модели</h3>
<p>Сравнение Kafka и RabbitMQ — почти обязательный вопрос. Слабый ответ: «Kafka быстрее, RabbitMQ проще». Сильный ответ начинается с <strong>модели</strong>: RabbitMQ — это брокер очередей (smart broker, simple consumer), Kafka — распределённый лог (simple broker, smart consumer). Из модели вытекают все практические различия.</p>

<h3>RabbitMQ в объёме, нужном для сравнения</h3>
<p>RabbitMQ реализует AMQP 0-9-1 (а в линейке 4.x — нативно и AMQP 1.0). Ключевые сущности:</p>
<ul>
  <li><strong>Exchange</strong> — точка, куда producer публикует сообщение. Сам ничего не хранит, только маршрутизирует по правилам.</li>
  <li><strong>Queue</strong> — очередь, где сообщения хранятся до получения подтверждения.</li>
  <li><strong>Binding</strong> — правило «exchange → queue» с ключом маршрутизации.</li>
</ul>
<p>Типы exchange: <code>direct</code> (точное совпадение routing key), <code>topic</code> (шаблоны вида <code>order.*.created</code>, <code>order.#</code>), <code>fanout</code> (всем привязанным очередям), <code>headers</code> (по заголовкам). Гибкая маршрутизация на брокере — сильная сторона RabbitMQ: producer шлёт в exchange, а кто что получит, решают binding-и.</p>
<p>Доставка — <strong>push</strong>: брокер сам отправляет сообщения подписанному consumer-у, ограничение — <strong>prefetch</strong> (<code>basic.qos</code>), сколько неподтверждённых сообщений может быть у consumer-а одновременно. Consumer подтверждает каждое сообщение (<code>ack</code>) или отвергает (<code>nack</code>/<code>reject</code>, с возвратом в очередь или без). Подтверждённое сообщение <strong>удаляется</strong> из очереди. Неподтверждённое при обрыве соединения возвращается в очередь и уходит другому consumer-у.</p>
<p>Встроенные возможности: <strong>dead letter exchange</strong> (куда уходят отвергнутые, просроченные по TTL или вытесненные сообщения), TTL сообщений и очередей, приоритетные очереди, отложенная доставка (через плагин или через TTL + DLX), request-reply через <code>reply_to</code> и <code>correlation_id</code>.</p>
<p>Надёжность и кластер: рекомендуемый тип очереди — <strong>quorum queues</strong> (реплицируемые, на Raft); классические зеркалируемые очереди удалены в RabbitMQ 4.0. Publisher confirms — аналог acks у producer-а. Есть и <strong>RabbitMQ Streams</strong> (с версии 3.9) — log-структура с retention и чтением с offset, то есть RabbitMQ тоже умеет replay, если использовать стримы вместо очередей.</p>
<p>В .NET: <code>RabbitMQ.Client</code> (в версии 7 API стал полностью асинхронным), поверх — MassTransit, NServiceBus, EasyNetQ.</p>

<h3>Ключевые различия</h3>
<table>
<thead><tr><th></th><th>Kafka</th><th>RabbitMQ (classic/quorum queues)</th></tr></thead>
<tbody>
<tr><td>Модель</td><td>Лог, сообщения хранятся по retention</td><td>Очередь, сообщение удаляется после ack</td></tr>
<tr><td>Получение</td><td>Pull: consumer запрашивает batch-и</td><td>Push с prefetch</td></tr>
<tr><td>Состояние чтения</td><td>Один offset на partition у группы</td><td>Брокер отслеживает каждое сообщение (unacked, redelivered)</td></tr>
<tr><td>Replay</td><td>Да, сдвигом offset, в пределах retention</td><td>Нет (кроме Streams)</td></tr>
<tr><td>Несколько подписчиков</td><td>Каждая consumer group читает всё независимо</td><td>Fanout/topic exchange в отдельные очереди — копия на очередь</td></tr>
<tr><td>Порядок</td><td>Внутри partition, по ключу</td><td>Внутри очереди при одном consumer-е; с конкурирующими consumers и redelivery порядок нарушается (есть single active consumer)</td></tr>
<tr><td>Масштаб consumers</td><td>Ограничен числом partitions</td><td>Конкурирующие consumers на одной очереди — сколько угодно</td></tr>
<tr><td>Маршрутизация</td><td>Простая: topic + partition; фильтрация — на consumer-е</td><td>Богатая на брокере: exchanges, bindings, шаблоны</td></tr>
<tr><td>Ack отдельных сообщений</td><td>Нет, только offset (нельзя пропустить одно «сложное» сообщение, не сдвинув offset)</td><td>Да, ack/nack каждого сообщения, requeue</td></tr>
<tr><td>Отложенные сообщения, приоритеты, TTL</td><td>Нет встроенных; строятся вручную (retry topics)</td><td>Есть (TTL, DLX, приоритеты, delayed-плагин)</td></tr>
<tr><td>Throughput</td><td>Очень высокий: последовательный I/O, batching</td><td>Высокий, но на сообщение больше работы брокера</td></tr>
<tr><td>Типичная роль</td><td>Поток событий, интеграция доменов, event sourcing, стриминг, CDC, аналитика</td><td>Очереди задач, RPC, сложная маршрутизация, рабочие процессы</td></tr>
</tbody>
</table>

<h3>Надёжность и семантики: те же вопросы, другие механизмы</h3>
<p>Семантики доставки в RabbitMQ устроены так же, как в Kafka, только на других рычагах. Со стороны producer-а аналог <code>acks=all</code> — <strong>publisher confirms</strong> (брокер подтверждает, что сообщение принято и, для durable/quorum очередей, сохранено), плюс флаг <code>mandatory</code>, чтобы узнать о сообщении, которое не попало ни в одну очередь из-за неверной маршрутизации. Со стороны consumer-а аналог «коммита после обработки» — <strong>ручной ack после обработки</strong>; автоматический ack (<code>autoAck</code>) — это at-most-once. Redelivery после обрыва соединения даёт at-least-once с флагом <code>redelivered</code>, поэтому идемпотентность consumers и Transactional Outbox нужны точно так же: dual write между БД и RabbitMQ — та же проблема. Важная разница: в RabbitMQ <code>nack</code> с <code>requeue=true</code> возвращает сообщение в очередь, и poison message может крутиться бесконечно, нагружая брокер, — поэтому ставят ограничение попыток (у quorum queues есть лимит доставок) и DLX. В Kafka аналогичная проблема — остановленная partition.</p>

<h3>Когда что выбирать</h3>
<h4>Kafka</h4>
<ul>
  <li>События нужны <strong>многим независимым потребителям</strong>, в том числе тем, кто появится позже, — каждый читает со своей скоростью.</li>
  <li>Нужен <strong>replay</strong>: перестроить проекцию, переобработать после бага, восстановить состояние.</li>
  <li>Высокий поток: сотни тысяч и миллионы событий в секунду, кликстрим, логи, телеметрия, CDC.</li>
  <li>Порядок по ключу (по заказу, по счёту) при горизонтальном масштабировании.</li>
  <li>Стриминговая обработка (Kafka Streams, Flink, ksqlDB), интеграции через Kafka Connect.</li>
</ul>
<h4>RabbitMQ</h4>
<ul>
  <li><strong>Очередь задач</strong> с конкурирующими воркерами, где каждое задание выполняется один раз и после этого не нужно: генерация отчётов, отправка писем, обработка картинок.</li>
  <li>Задачи разной длительности: prefetch=1 и ack по сообщению равномерно распределяют долгие задачи, и одна медленная задача не блокирует остальные (в Kafka она держит partition).</li>
  <li><strong>Сложная маршрутизация</strong> по ключам и шаблонам, приоритеты, TTL, отложенная доставка «из коробки».</li>
  <li>Request-reply поверх брокера.</li>
  <li>Умеренные объёмы, где важнее гибкость, чем экстремальный throughput.</li>
</ul>
<blockquote>В больших компаниях часто есть оба: Kafka как шина событий между доменами, RabbitMQ (или очереди внутри сервиса) — для фоновых задач внутри одной системы. Говорить «только Kafka» или «только RabbitMQ» как религиозную позицию — плохой сигнал.</blockquote>
<p>Отдельно стоит знать: в Kafka 4.x развивается функциональность «очередей» — <strong>share groups</strong> (KIP-932, Queues for Kafka): потребители группы делят сообщения одной partition между собой с подтверждением отдельных сообщений, без жёсткой привязки partition к одному consumer-у. В 4.0 она вышла как early access, в 4.1 — как preview, а в 4.2 объявлена production-ready; поддержку в конкретном клиенте (в том числе librdkafka) надо проверять на момент выбора. Если на собеседовании об этом спросят — достаточно знать идею и что это снимает ограничение «параллелизм = partitions» для сценариев очереди задач.</p>

<h3>Redis Streams</h3>
<p>Структура данных Redis, похожая на лог: <code>XADD</code> добавляет запись с id (по времени), <code>XREAD</code> читает, <strong>consumer groups</strong> (<code>XREADGROUP</code>) распределяют записи между потребителями, <code>XACK</code> подтверждает, неподтверждённые хранятся в <strong>pending entries list</strong> и могут быть переназначены (<code>XCLAIM</code>, <code>XAUTOCLAIM</code>). Длина ограничивается обрезкой (<code>MAXLEN</code>). Плюсы: Redis уже есть в инфраструктуре, низкая задержка, простота. Минусы: данные в памяти (объём ограничен RAM), репликация в Redis асинхронная — при failover последние записи могут потеряться; нет партиционирования одного стрима по узлам в смысле Kafka. Подходит для небольших очередей событий и задач внутри системы, не для шины данных компании.</p>

<h3>NATS</h3>
<p><strong>Core NATS</strong> — очень лёгкий pub/sub по subjects (с шаблонами <code>orders.*</code>, <code>orders.&gt;</code>) и request-reply, без хранения: at-most-once, подписчик офлайн — сообщение потеряно. <strong>JetStream</strong> — слой персистентности поверх: streams с retention, durable consumers (push и pull), подтверждения, at-least-once, replay, дедупликация публикаций по заголовку <code>Nats-Msg-Id</code> в пределах окна. Плюсы: простота эксплуатации, один бинарник, низкая задержка, удобный request-reply. Минусы: экосистема интеграций и стриминговой обработки значительно меньше, чем у Kafka.</p>

<h3>Как отвечать на вопрос «какой брокер выбрать»</h3>
<p>Интервьюер проверяет не знание продуктов, а умение рассуждать от требований. Структура ответа:</p>
<ol>
  <li><strong>Характер взаимодействия</strong>: поток событий для многих потребителей (Kafka) или задания для воркеров (очередь)?</li>
  <li><strong>Нужно ли хранить и перечитывать</strong>? Replay, новые потребители со старыми данными, event sourcing — аргумент за лог.</li>
  <li><strong>Порядок</strong>: нужен ли, в каком масштабе (по ключу — Kafka делает естественно).</li>
  <li><strong>Объём и задержка</strong>: тысячи сообщений в секунду потянет всё; миллионы — Kafka.</li>
  <li><strong>Маршрутизация, приоритеты, отложенная доставка</strong> — RabbitMQ даёт из коробки.</li>
  <li><strong>Неравномерные долгие задачи</strong> — очередь с ack по сообщению лучше распределяет.</li>
  <li><strong>Эксплуатация и что уже есть</strong>: экспертиза команды, managed-сервис, существующая инфраструктура. В российских компаниях часто важно и то, что доступно on-premise.</li>
</ol>
<p>Пример формулировки: «Для интеграции заказов с сервисом валидации другого домена выбрал бы Kafka: событие нужно нескольким потребителям, нужен порядок по заказу, нужна возможность переобработать события после инцидента, и поток большой. Для генерации PDF-отчётов по запросу пользователя — очередь: задачи независимые, разной длительности, после выполнения не нужны, важен ack каждой задачи и равномерное распределение по воркерам».</p>

<h3>Что спросят на собеседовании</h3>
<ul>
  <li><strong>«Чем Kafka отличается от RabbitMQ?»</strong> — лог против очереди, pull против push, offset против ack каждого сообщения, replay, масштаб по partitions против конкурирующих consumers, маршрутизация.</li>
  <li><strong>«Когда RabbitMQ лучше Kafka?»</strong> — очереди задач разной длительности, ack по сообщению, маршрутизация, TTL/DLX/приоритеты/задержки, request-reply.</li>
  <li><strong>«Можно ли в RabbitMQ перечитать сообщения?»</strong> — в обычных очередях нет; в Streams — да.</li>
  <li><strong>«Почему в Kafka нельзя подтвердить одно сообщение?»</strong> — offset — одно число на partition; отсюда retry topics и DLQ; share groups как развитие.</li>
  <li><strong>«Что бы вы выбрали для X?»</strong> — рассуждение от требований, а не от любимой технологии.</li>
</ul>
`
    },
  ],
  questions: [
    {
      id: 'kafka-001', chapter: 'architecture', type: 'choice',
      q: `В topic 6 partitions. Producer пишет события разных заказов с ключом = orderId. Какой порядок гарантирует Kafka?`,
      options: [
        `Глобальный порядок всех событий topic в порядке записи`,
        `Порядок событий внутри каждой partition, а значит — порядок событий одного заказа`,
        `Порядок только при одном consumer-е в группе`,
        `Никакого порядка: offsets назначаются брокерами независимо`
      ],
      answer: 1,
      explain: `Порядок есть только внутри partition. Одинаковый ключ всегда попадает в одну partition (пока не изменилось число partitions), поэтому события одного заказа упорядочены. Глобального порядка по topic нет даже при одном consumer-е: он читает несколько partitions, и их сообщения перемежаются произвольно.`
    },
    {
      id: 'kafka-002', chapter: 'architecture', type: 'open',
      q: `Почему Kafka выдерживает такой высокий throughput? Назовите конкретные механизмы.`,
      answer: `<ul>
<li><strong>Последовательный I/O</strong>: только append в конец сегмента и последовательное чтение; нет случайных записей и обновлений на месте.</li>
<li><strong>Page cache ОС</strong> вместо кэша в куче JVM: свежие данные читаются из памяти, нет давления на GC, кэш переживает рестарт процесса. Нет fsync на каждую запись — надёжность через репликацию.</li>
<li><strong>Zero-copy</strong> (<code>sendfile</code>): из page cache прямо в сокет, потому что формат на диске совпадает с сетевым. Оговорка: при TLS не работает.</li>
<li><strong>Batching</strong> у producer-а (linger.ms, batch.size) и у consumer-а (крупные fetch), сжатие batch-ами end-to-end — брокер хранит сжатое как есть.</li>
<li><strong>Партиционирование</strong>: нагрузка делится по partitions и брокерам.</li>
<li><strong>Простой брокер</strong>: не отслеживает доставку каждого сообщения, у группы один offset на partition.</li>
</ul>`
    },
    {
      id: 'kafka-003', chapter: 'architecture', type: 'choice',
      q: `В compacted topic producer записал для ключа <code>user-42</code> запись с value = null. Что с ней произойдёт?`,
      options: [
        `Брокер отвергнет запись: в compacted topic value не может быть null`,
        `Запись немедленно удалит из лога все предыдущие значения ключа`,
        `Это tombstone: compaction со временем уберёт старые значения ключа, а сам tombstone удалится после delete.retention.ms`,
        `Tombstone хранится вечно, чтобы любой новый consumer узнал об удалении`
      ],
      answer: 2,
      explain: `Null value — tombstone, маркер удаления. Compaction асинхронная, поэтому «немедленно» неверно: активный сегмент не компактится, старые значения какое-то время остаются. Tombstone держится delete.retention.ms (по умолчанию сутки), чтобы отстающие consumers успели увидеть удаление, а потом исчезает — consumer, начавший читать с нуля позже, ключа не увидит вовсе. Отвергаются в compacted topic записи без ключа, а не с null value.`
    },
    {
      id: 'kafka-004', chapter: 'architecture', type: 'choice',
      q: `Нагрузка выросла, и вы увеличили число partitions topic <code>orders</code> с 12 до 24. Какое последствие самое важное для бизнес-логики?`,
      options: [
        `Старые сообщения перераспределятся по новым partitions`,
        `Ничего: ключи всегда остаются в своих partitions`,
        `Все consumer groups сбросят offsets на earliest`,
        `Для части ключей изменится partition, и порядок событий этих ключей на переходе может нарушиться`
      ],
      answer: 3,
      explain: `Partition = hash(key) mod N, поэтому при смене N меняется отображение для многих ключей. Старые данные никуда не переезжают, а новые события того же заказа пойдут в другую partition, и consumer может обработать новое событие раньше старого, ещё не дочитанного в исходной partition. Offsets не сбрасываются. Уменьшить число partitions нельзя вообще.`
    },
    {
      id: 'kafka-005', chapter: 'architecture', type: 'open',
      q: `Как брокер находит запись по offset? Зачем лог делится на сегменты?`,
      answer: `<p>Partition — это директория с сегментами; имя файла сегмента — base offset его первой записи. Брокер бинарным поиском выбирает сегмент, затем бинарным поиском по разреженному <code>.index</code> (отображён в память, запись примерно на каждые 4 КБ данных) находит ближайшую позицию в <code>.log</code> и дочитывает несколько килобайт последовательно. Для поиска по времени есть <code>.timeindex</code>.</p>
<p>Сегменты нужны, чтобы retention и compaction работали дёшево: удаляются и переписываются целые закрытые сегменты, активный сегмент только дописывается. Сегмент закрывается по <code>segment.bytes</code> или <code>segment.ms</code>, поэтому данные живут немного дольше retention.</p>`
    },
    {
      id: 'kafka-006', chapter: 'architecture', type: 'choice',
      q: `Что верно про ZooKeeper и KRaft в Kafka 4.0?`,
      options: [
        `ZooKeeper всё ещё поддерживается, но объявлен устаревшим`,
        `KRaft — опциональный режим для новых кластеров`,
        `ZooKeeper удалён; метаданные хранятся в Raft-кворуме controller-ов в topic __cluster_metadata`,
        `Клиентам нужно указать адрес controller-кворума вместо bootstrap.servers`
      ],
      answer: 2,
      explain: `В 4.0 ZooKeeper-режим удалён полностью. Устаревшим его объявили ещё в 3.5, а 3.x были переходными с инструментами миграции. Клиенты по-прежнему подключаются к брокерам через bootstrap.servers — для них переход прозрачен.`
    },
    {
      id: 'kafka-007', chapter: 'architecture', type: 'open',
      q: `Сценарий: consumer group сервиса отчётов не работала 9 дней из-за аварии, retention topic — 7 дней. Что произойдёт при её запуске?`,
      answer: `<p>Retention не учитывает, прочитано ли сообщение: сегменты старше 7 дней удалены. Committed offset группы указывает на данные, которых больше нет (out of range), поэтому сработает <code>auto.offset.reset</code>: при <code>earliest</code> группа начнёт с самого раннего доступного сообщения — два дня событий потеряны безвозвратно; при <code>latest</code> — пропустит вообще всё накопленное. Возможна и ещё одна ловушка: если группа долго была пустой, её offsets могли истечь (<code>offsets.retention.minutes</code>, по умолчанию 7 дней) — тогда тоже применится auto.offset.reset.</p>
<p>Выводы: алерты на lag во времени относительно retention, retention с запасом для критичных потребителей, при длительных простоях — восстановление из источника (outbox, БД, архив в объектном хранилище).</p>`
    },
    {
      id: 'kafka-008', chapter: 'replication', type: 'choice',
      q: `Topic с replication.factor=3, min.insync.replicas=2, producer с acks=all. Два брокера из трёх, хранящих реплики, недоступны. Что будет?`,
      options: [
        `Запись продолжается, лидер подтверждает её сам, после возвращения брокеров они догонят`,
        `Запись отклоняется с NotEnoughReplicas, чтение уже записанного работает, подтверждённые данные не потеряны`,
        `Partition целиком недоступна и для записи, и для чтения`,
        `Включается unclean leader election, и запись продолжается`
      ],
      answer: 1,
      explain: `В ISR остался один лидер, а min.insync.replicas=2 требует двух для записи с acks=all — брокер отвечает NotEnoughReplicas, producer ретраит. Чтение до high watermark работает. Первый вариант описывает поведение при min.insync.replicas=1 — именно от него эта настройка защищает. Unclean election по умолчанию выключен и к тому же касается выбора лидера, а лидер здесь жив.`
    },
    {
      id: 'kafka-009', chapter: 'replication', type: 'open',
      q: `Что такое ISR и high watermark? Почему consumer не видит запись, которая уже лежит на лидере?`,
      answer: `<p><strong>ISR</strong> — реплики, которые успевают за лидером: follower выпадает, если не догонял конец лога дольше <code>replica.lag.time.max.ms</code> (критерий — время, не число сообщений). Новым лидером может стать только член ISR (без unclean election).</p>
<p><strong>High watermark</strong> — offset, до которого запись есть на всех репликах ISR; лидер считает его как минимум LEO по ISR. Consumers читают только ниже HW. Если бы consumer прочитал запись, существующую лишь на лидере, а лидер упал бы, новый лидер из ISR не имел бы её — прочитанное «исчезло» бы, и offset мог бы быть переиспользован другими данными. HW гарантирует, что прочитанное переживает failover. Для транзакций дополнительно есть LSO для read_committed.</p>`
    },
    {
      id: 'kafka-010', chapter: 'replication', type: 'choice',
      q: `Producer использует acks=all, topic — RF=3, min.insync.replicas=1 (по умолчанию). Чем это опасно?`,
      options: [
        `Ничем: acks=all всегда ждёт все три реплики`,
        `Producer будет получать NotEnoughReplicas при любом рестарте брокера`,
        `Если ISR сжался до лидера, acks=all подтвердит запись, которая есть только на нём, и её можно потерять при падении лидера`,
        `acks=all несовместим с min.insync.replicas=1, producer не создастся`
      ],
      answer: 2,
      explain: `acks=all — это все реплики текущего ISR, а не все реплики вообще. При отставших followers ISR = {leader}, и acks=all вырождается в acks=1. min.insync.replicas=2 запретил бы такую запись. Ошибки NotEnoughReplicas при рестарте одного брокера характерны скорее для min.insync.replicas=3 при RF=3.`
    },
    {
      id: 'kafka-011', chapter: 'replication', type: 'choice',
      q: `Что делает unclean.leader.election.enable=true?`,
      options: [
        `Позволяет выбрать лидером реплику не из ISR, восстанавливая доступность ценой возможной потери подтверждённых записей`,
        `Ускоряет выбор лидера за счёт отказа от кворума controller-ов`,
        `Разрешает producer-у писать в follower, если лидер недоступен`,
        `Автоматически возвращает лидерство preferred replica`
      ],
      answer: 0,
      explain: `Если все члены ISR недоступны, со включённым unclean election лидером станет отставшая реплика: partition снова доступна, но записей, которых у неё не было, больше нет, а вернувшийся старый лидер обрежет лог. По умолчанию выключено. Возврат лидерства preferred replica — другая настройка, auto.leader.rebalance.enable.`
    },
    {
      id: 'kafka-012', chapter: 'replication', type: 'open',
      q: `Перечислите, где и как можно потерять сообщения в системе на Kafka — не только на брокере.`,
      answer: `<ul>
<li>Брокер: acks=0/1 и падение лидера до репликации; acks=all при min.insync.replicas=1; unclean leader election; RF=1; одновременный сбой питания всех реплик (нет fsync на каждую запись) — лечится разнесением по зонам (<code>broker.rack</code>).</li>
<li>Producer: не проверяется delivery report (ошибка проглочена); процесс завершился без <code>Flush</code> — буфер librdkafka пропал; истёк <code>message.timeout.ms</code> при недоступном кластере; dual write без outbox.</li>
<li>Consumer: offset закоммичен до обработки (автокоммит с автоматическим offset store) и падение; сообщение пропущено при ошибке «чтобы не стоять»; <code>auto.offset.reset=latest</code> для новой группы или после истечения offsets.</li>
<li>Хранение: retention удалил непрочитанное; compaction убрал промежуточные значения.</li>
</ul>`
    },
    {
      id: 'kafka-013', chapter: 'replication', type: 'choice',
      q: `Лидер записал batch в свой лог, но followers ещё не успели его скопировать. Consumer запрашивает данные. Что он получит?`,
      options: [
        `Только записи ниже high watermark — новый batch станет виден после репликации на ISR`,
        `Этот batch — consumer всегда читает до LEO лидера`,
        `Ошибку NotLeaderForPartition`,
        `Batch, но с флагом uncommitted`
      ],
      answer: 0,
      explain: `Consumers читают только до high watermark — offset, реплицированного на весь ISR. Это защищает от чтения записи, которая может исчезнуть при failover. Флаги «uncommitted» относятся к транзакциям и обрабатываются через LSO и read_committed, а не к репликации.`
    },
    {
      id: 'kafka-014', chapter: 'producer', type: 'choice',
      q: `Producer без идемпотентности, acks=all, ретраи включены. В логе изредка появляются дубликаты сообщений. Наиболее вероятная причина?`,
      options: [
        `Брокер записал batch, но ответ до producer-а не дошёл (таймаут), и producer повторил отправку`,
        `Followers копируют сообщения дважды при репликации`,
        `Consumer прочитал сообщение дважды и записал обратно`,
        `Compaction создаёт копии записей`
      ],
      answer: 0,
      explain: `Классический источник дубликатов — потерянный ответ на успешную запись: producer не знает, что запись прошла, и ретраит. Идемпотентный producer устраняет это: брокер видит повторный sequence number для того же PID и не пишет batch второй раз. Репликация и compaction дубликатов не создают.`
    },
    {
      id: 'kafka-015', chapter: 'producer', type: 'open',
      q: `Как работает идемпотентный producer и от чего он НЕ защищает?`,
      answer: `<p>При <code>enable.idempotence=true</code> producer получает от брокера PID и epoch, каждый batch на каждую partition получает sequence number. Брокер помнит последние sequence для пары (PID, partition): повтор — дубликат, его не пишут, но отвечают успехом; пропуск — ошибка out-of-order. Требует acks=all и max.in.flight ≤ 5, при этом сохраняет порядок с ретраями. В Confluent.Kafka (librdkafka) по умолчанию выключен — включать явно.</p>
<p>Не защищает: от дубликатов между сессиями — после рестарта новый PID, и повторная отправка приложением (например, relay outbox не успел пометить запись) — новое сообщение; от дублей на уровне бизнес-логики и от повторной обработки у consumer-а. Для первого — транзакции с transactional.id, для остального — идемпотентные consumers.</p>`
    },
    {
      id: 'kafka-016', chapter: 'producer', type: 'choice',
      q: `В topic с ключом orderId пишут Java-сервис и .NET-сервис на Confluent.Kafka с настройками по умолчанию. Consumer видит, что события одного заказа иногда приходят не по порядку. Почему?`,
      options: [
        `Confluent.Kafka не поддерживает ключи сообщений`,
        `Java-клиент сортирует сообщения по timestamp перед отправкой`,
        `.NET-клиент всегда отправляет сообщения в partition 0`,
        `Partitioner по умолчанию разный: murmur2 в Java и consistent_random (CRC32) в librdkafka — один ключ попадает в разные partitions`
      ],
      answer: 3,
      explain: `Хэш-функции partitioner-ов по умолчанию различаются, поэтому одинаковые ключи из разных клиентов оказываются в разных partitions, а порядок есть только внутри partition. Решение — Partitioner = Partitioner.Murmur2Random в ProducerConfig .NET-сервиса.`
    },
    {
      id: 'kafka-017', chapter: 'producer', type: 'choice',
      q: `Миграционный скрипт отправляет 1 млн событий циклом <code>foreach (...) await producer.ProduceAsync(...)</code>. Он работает очень медленно. Почему?`,
      options: [
        `ProduceAsync синхронно пишет на диск брокера`,
        `Каждое сообщение ждёт delivery report перед отправкой следующего — batching не работает, throughput ограничен сетевой задержкой`,
        `ProduceAsync создаёт новое TCP-соединение на каждый вызов`,
        `Confluent.Kafka ограничивает отправку одним сообщением в секунду без лицензии`
      ],
      answer: 1,
      explain: `Последовательный await делает каждый batch из одного сообщения и добавляет round-trip (плюс linger) на каждое событие. Правильно: отправлять много без ожидания и ждать пачку задач (Task.WhenAll) или использовать Produce с callback и Flush в конце. Соединения у producer-а долгоживущие и общие.`
    },
    {
      id: 'kafka-018', chapter: 'producer', type: 'open',
      q: `Зачем нужен transactional.id и что такое fencing?`,
      answer: `<p><code>transactional.id</code> — стабильный идентификатор транзакционного producer-а, переживающий рестарты (привязан к экземпляру приложения или к обрабатываемой partition). При <code>InitTransactions</code> transaction coordinator находит предыдущую инкарнацию с этим id, завершает или откатывает её незаконченную транзакцию и увеличивает epoch.</p>
<p><strong>Fencing</strong>: если старый экземпляр жив (например, был в сетевом разделении и считается мёртвым), его запросы с меньшим epoch брокер отвергает. Так два экземпляра не запишут результат одной и той же работы — «зомби» отсечён. Это то, чего не даёт одна идемпотентность: она защищает только внутри сессии одного PID. Ошибка fencing фатальна — producer нужно пересоздать.</p>`
    },
    {
      id: 'kafka-019', chapter: 'producer', type: 'choice',
      q: `Сервис вызывает producer.Produce(...) с callback и сразу завершает процесс (Dispose без Flush). Что с сообщениями?`,
      options: [
        `Сообщения, ещё лежащие в локальной очереди librdkafka, могут быть потеряны`,
        `Они гарантированно доставлены: Produce синхронный`,
        `Брокер сам дочитает их из памяти клиента после рестарта`,
        `Они сохранятся на диск клиента и будут отправлены при следующем старте`
      ],
      answer: 0,
      explain: `Produce только кладёт сообщение в буфер librdkafka; отправка идёт в фоне. При завершении без Flush всё, что не успело уйти, пропадает, и callbacks об этом могут не прийти. Локальной персистентности у клиента нет — для неё нужен outbox.`
    },
    {
      id: 'kafka-020', chapter: 'producer', type: 'open',
      q: `Как гарантировать порядок событий по заказу (Created → Paid → Shipped) от записи до обработки?`,
      answer: `<ul>
<li>Все события заказа — в <strong>один topic</strong> с <strong>key = orderId</strong>: одна partition, порядок в логе. Разные topics между собой не упорядочены.</li>
<li>Producer: идемпотентность (порядок при ретраях с max.in.flight ≤ 5); один partitioner у всех producer-ов (murmur2 при смешении Java и .NET); не менять число partitions на горячую.</li>
<li>Если события идут из outbox — отправка по возрастанию id, один relay или шардирование по ключу, пометка после подтверждения.</li>
<li>Consumer: обработка в partition последовательно или параллельно только по разным ключам; неблокирующие ретраи ломают порядок — парковать ключ или использовать версии.</li>
<li>Страховка: версия агрегата в событии, consumer игнорирует устаревшие версии.</li>
</ul>`
    },
    {
      id: 'kafka-021', chapter: 'consumer', type: 'choice',
      q: `В topic 10 partitions, в consumer group запущено 15 экземпляров. Что происходит?`,
      options: [
        `Каждая partition читается полутора consumer-ами по очереди`,
        `Сообщения распределяются по всем 15 экземплярам round-robin`,
        `Kafka автоматически добавит 5 partitions`,
        `10 экземпляров читают по одной partition, 5 простаивают`
      ],
      answer: 3,
      explain: `В группе partition назначается ровно одному consumer-у. Лишние экземпляры простаивают — они полезны только как горячий резерв. Масштаб группы ограничен числом partitions (если не использовать share groups из новых версий Kafka).`
    },
    {
      id: 'kafka-022', chapter: 'consumer', type: 'open',
      q: `Обработка некоторых сообщений занимает 7 минут, max.poll.interval.ms — 5 минут. Опишите, что будет происходить, и как это исправить.`,
      answer: `<p>Через 5 минут без вызова <code>Consume</code> librdkafka покинет группу; partitions переназначат другому экземпляру, который начнёт с последнего committed offset и обработает те же сообщения заново — дубликаты. Когда первый экземпляр закончит, его Commit/StoreOffset для этих partitions не сработают, он вернётся в группу — очередная ребалансировка. Если долгие сообщения регулярны, группа уходит в цикл ребалансировок, lag растёт.</p>
<p>Исправление: ускорить обработку или делать её пачкой эффективнее; поднять <code>max.poll.interval.ms</code> под реальное худшее время; вынести долгую работу из consumer-а (consumer принимает задачу и сохраняет, исполнитель отдельно); при асинхронной обработке ставить partitions на <code>Pause</code> и продолжать вызывать Consume. И в любом случае — идемпотентная обработка.</p>`
    },
    {
      id: 'kafka-023', chapter: 'consumer', type: 'choice',
      q: `Consumer на Confluent.Kafka с настройками по умолчанию (enable.auto.commit=true, enable.auto.offset.store=true). Какую гарантию это даёт при падении посреди обработки?`,
      options: [
        `Exactly-once: offset коммитится атомарно с обработкой`,
        `At-least-once: offset коммитится только после обработки`,
        `Гарантии «не потеряем» нет: offset сохраняется при выдаче сообщения и может быть закоммичен фоном до окончания обработки`,
        `At-most-once без исключений: сообщение никогда не перечитывается`
      ],
      answer: 2,
      explain: `librdkafka запоминает offset в момент возврата сообщения из Consume, а фоновый поток коммитит запомненное каждые 5 секунд. Если коммит успел до падения — сообщение потеряно; если нет — переобработается. Строгого at-most-once тоже нет, но главное: нет гарантии at-least-once. Решение — EnableAutoOffsetStore=false и StoreOffset после обработки.`
    },
    {
      id: 'kafka-024', chapter: 'consumer', type: 'choice',
      q: `Вы обработали сообщение с offset 41 и вызываете <code>consumer.Commit(result)</code> в Confluent.Kafka. Какой offset будет закоммичен?`,
      options: [
        `41`,
        `40`,
        `42 — следующий для чтения; перегрузка с ConsumeResult прибавляет 1 сама`,
        `Последний offset partition`
      ],
      answer: 2,
      explain: `Committed offset — это следующий offset, который должна прочитать группа. Commit(ConsumeResult) и StoreOffset(ConsumeResult) прибавляют единицу. Ловушка — перегрузки с TopicPartitionOffset: там offset берётся как есть, и при передаче 41 сообщение 41 после рестарта прочитается снова.`
    },
    {
      id: 'kafka-025', chapter: 'consumer', type: 'open',
      q: `Чем eager rebalance отличается от cooperative sticky? Что даёт static membership?`,
      answer: `<p><strong>Eager</strong> (range, roundrobin): в начале ребалансировки все consumers отзывают все partitions, затем получают новое распределение — группа целиком стоит. При rolling deploy это происходит многократно.</p>
<p><strong>Cooperative sticky</strong>: отзываются только partitions, которые действительно переезжают, в два раунда; остальные обрабатываются без остановки, распределение стремится не меняться. В Confluent.Kafka обработчики assigned/revoked получают только изменения.</p>
<p><strong>Static membership</strong> (<code>group.instance.id</code>): у экземпляра постоянная идентичность; вернувшись в пределах <code>session.timeout.ms</code>, он получает свои partitions без ребалансировки. Цена — при настоящей смерти partitions простаивают до таймаута. Дальнейшее развитие — протокол KIP-848 (Kafka 4.0, <code>group.protocol=consumer</code>): распределение считает брокер, без глобального барьера.</p>`
    },
    {
      id: 'kafka-026', chapter: 'consumer', type: 'choice',
      q: `Процесс consumer-а жив, heartbeat-ы идут, но обработка одного сообщения зависла на внешнем вызове. Какой механизм выведет consumer из группы?`,
      options: [
        `session.timeout.ms`,
        `heartbeat.interval.ms`,
        `max.poll.interval.ms`,
        `request.timeout.ms`
      ],
      answer: 2,
      explain: `Heartbeat отправляется фоновым потоком, поэтому session.timeout.ms ловит только мёртвый процесс или потерю сети. Зависшую обработку при живом процессе ловит max.poll.interval.ms — максимальное время между вызовами Consume.`
    },
    {
      id: 'kafka-027', chapter: 'consumer', type: 'open',
      q: `Обработка упирается в I/O, partitions добавить нельзя. Как распараллелить обработку внутри partition, сохранив порядок по ключу, и что сложнее всего?`,
      answer: `<p>Поток consumer-а раскладывает сообщения по N внутренним очередям (например, <code>Channel&lt;T&gt;</code>) по хэшу ключа: один ключ — всегда одна очередь, внутри очереди обработка последовательная, разные очереди — параллельно. Порядок по ключу сохранён, общий порядок partition — нет.</p>
<p>Самое сложное — коммит: сообщения завершаются не по порядку, а offset partition — одно число. Нужен трекер: коммитить можно только минимальный незавершённый offset (всё ниже готово). Плюс ограничение числа сообщений в полёте (память и объём переобработки при падении, Pause при переполнении), а при отзыве partitions — дождаться или отменить их сообщения и закоммитить. Consumer API — только из одного потока. Альтернативы: batch-обработка, KafkaFlow с worker-ами по ключу.</p>`
    },
    {
      id: 'kafka-028', chapter: 'consumer', type: 'choice',
      q: `Какой алерт на consumer lag полезнее всего?`,
      options: [
        `Lag во времени (возраст самого старого необработанного сообщения) или устойчивый рост lag`,
        `Lag группы больше 10 000 сообщений`,
        `Lag ненулевой дольше секунды`,
        `Lag не нужно мониторить, если включён автокоммит`
      ],
      answer: 0,
      explain: `Абсолютное число сообщений зависит от трафика: 10 000 при 50 000 msg/s — пустяк, а 100 при одном в минуту — полтора часа задержки. Ненулевой lag — нормальное состояние. Смотрят lag во времени, тренд и максимум по partition (горячая partition прячется в сумме).`
    },
    {
      id: 'kafka-029', chapter: 'semantics', type: 'open',
      q: `Сценарий: consumer обработал сообщение (записал в БД), но упал до коммита offset. Что будет и как с этим жить?`,
      answer: `<p>После рестарта (или ребалансировки к другому экземпляру) группа продолжит с последнего committed offset, и сообщение будет обработано повторно — это нормальное поведение at-least-once. Если обработка не идемпотентна, будет дубль: второй платёж, двойное списание, повторное письмо.</p>
<p>Как жить: делать обработку идемпотентной — inbox-таблица с уникальным event_id в той же транзакции, что и бизнес-изменение; уникальные бизнес-ключи с <code>ON CONFLICT DO NOTHING</code>; версии агрегата; операции «установить значение» вместо «прибавить». Либо хранить offset в той же БД в той же транзакции и делать Seek при назначении partition — тогда результат и offset фиксируются атомарно. Kafka-транзакции здесь не помогут, потому что эффект — во внешней БД.</p>`
    },
    {
      id: 'kafka-030', chapter: 'semantics', type: 'choice',
      q: `Сервис читает из topic A, вызывает HTTP API платёжного шлюза и пишет результат в topic B, используя Kafka-транзакции и read_committed. Какая гарантия у вызова платёжного шлюза?`,
      options: [
        `Exactly-once: Kafka-транзакция откатит HTTP-вызов при сбое`,
        `At-least-once: при откате транзакции и повторной обработке вызов повторится; нужна идемпотентность на стороне шлюза (idempotency key)`,
        `At-most-once: транзакция гарантирует, что вызов не повторится`,
        `Exactly-once, если включён enable.idempotence`
      ],
      answer: 1,
      explain: `Kafka EOS покрывает только read-process-write внутри Kafka: записи в B и offsets A фиксируются атомарно. Внешний HTTP-вызов транзакцией не откатывается, а при повторе после сбоя выполнится снова. Защищаются idempotency key, который понимает внешний сервис (например, id события).`
    },
    {
      id: 'kafka-031', chapter: 'semantics', type: 'open',
      q: `Как не потерять событие при записи в БД и Kafka? Почему нельзя просто сначала сохранить в БД, а потом отправить в Kafka?`,
      answer: `<p>Это проблема <strong>dual write</strong>: две независимые системы без общей транзакции. Сначала БД, потом Kafka — падение процесса, деплой или недоступность Kafka между шагами оставят заказ без события, и подписчики никогда о нём не узнают. Сначала Kafka, потом БД — событие о заказе, транзакция которого откатилась. Ретраи внутри запроса не спасают от убитого процесса; 2PC между PostgreSQL и Kafka нет.</p>
<p>Решение — <strong>Transactional Outbox</strong>: в той же локальной транзакции, что и бизнес-изменение, вставить событие в таблицу outbox; атомарность обеспечивает БД. Отдельный relay (polling с <code>FOR UPDATE SKIP LOCKED</code> или CDC через Debezium по WAL) публикует записи в Kafka с key = aggregate id и помечает/удаляет после подтверждения. Семантика — at-least-once, поэтому событие несёт event_id, а consumers идемпотентны (inbox).</p>`
    },
    {
      id: 'kafka-032', chapter: 'semantics', type: 'choice',
      q: `Relay outbox запоминает последний опубликованный id и выбирает <code>WHERE id &gt; @last ORDER BY id</code>. Какая проблема возможна?`,
      options: [
        `Никакой: bigserial гарантирует, что строки становятся видимыми в порядке id`,
        `Relay будет публиковать каждую строку дважды`,
        `Запрос не использует индекс и всегда делает full scan`,
        `Транзакция с меньшим id может закоммититься позже транзакции с большим — relay сдвинет курсор и пропустит строку навсегда`
      ],
      answer: 3,
      explain: `Значение sequence берётся при вставке, а видимость наступает при коммите. Транзакция, получившая id 100, может закоммититься после транзакции с id 101: relay увидит 101, сдвинет курсор, и 100 уже никогда не попадёт в выборку. Поэтому выбирают по флагу «не опубликовано» (published_at IS NULL с частичным индексом), а не по курсору.`
    },
    {
      id: 'kafka-033', chapter: 'semantics', type: 'choice',
      q: `Чтобы ускорить outbox relay, запустили 4 экземпляра, каждый выбирает пачку с <code>FOR UPDATE SKIP LOCKED</code>. Что может сломаться?`,
      options: [
        `Порядок событий одного агрегата: соседние события заказа могут уйти из разных экземпляров в обратном порядке`,
        `Одна строка будет отправлена всеми четырьмя экземплярами`,
        `PostgreSQL заблокирует таблицу целиком`,
        `Идемпотентный producer отвергнет сообщения от разных экземпляров`
      ],
      answer: 0,
      explain: `SKIP LOCKED как раз не даёт двум экземплярам взять одну строку, но события одного заказа могут попасть в разные пачки и отправиться параллельно — порядок в partition нарушится. Варианты: один активный relay (лидер через advisory lock), шардирование relay по хэшу aggregate_id, или CDC, который читает журнал в порядке коммитов.`
    },
    {
      id: 'kafka-034', chapter: 'semantics', type: 'open',
      q: `Как реализовать идемпотентный consumer с inbox-таблицей? Какие ошибки при этом делают?`,
      answer: `<p>Таблица <code>inbox(consumer, message_id, processed_at)</code> с первичным ключом (consumer, message_id). В одной транзакции БД: <code>INSERT ... ON CONFLICT DO NOTHING</code>; если вставилось 0 строк — дубликат, ничего не делаем и сдвигаем offset; иначе выполняем бизнес-изменение и коммитим. Offset в Kafka сохраняем после коммита БД.</p>
<p>Ошибки: отметка в inbox в отдельной транзакции или в Redis (между отметкой и изменением снова окно сбоя); проверка «SELECT, потом INSERT» без уникального ключа — гонка при параллельной обработке; дедупликация по offset вместо event_id (не ловит дубликаты, записанные producer-ом дважды); отсутствие очистки inbox или слишком короткое окно хранения при возможном replay; общий inbox без поля consumer, когда одно событие обрабатывают несколько обработчиков.</p>`
    },
    {
      id: 'kafka-035', chapter: 'semantics', type: 'choice',
      q: `При каком порядке действий consumer-а получается at-most-once?`,
      options: [
        `Обработать сообщение, затем закоммитить offset`,
        `Обработать и закоммитить offset в одной транзакции БД`,
        `Закоммитить offset, затем обработать сообщение`,
        `Использовать inbox-таблицу`
      ],
      answer: 2,
      explain: `Если offset зафиксирован до обработки, падение во время обработки означает, что сообщение уже считается прочитанным — потеря, но без дубликатов. Обработка, затем коммит — at-least-once. Атомарная фиксация результата и offset в БД даёт effectively-once.`
    },
    {
      id: 'kafka-036', chapter: 'semantics', type: 'open',
      q: `Outbox relay: polling или CDC (Debezium)? Сравните.`,
      answer: `<ul>
<li><strong>Polling</strong>: простой код в приложении, нет новой инфраструктуры. Минусы: постоянные запросы к БД, задержка до интервала опроса, нужна очистка таблицы, аккуратность с порядком (один relay, выборка по флагу, а не по курсору).</li>
<li><strong>CDC</strong>: Debezium читает WAL через logical replication, Outbox Event Router превращает строки в сообщения (тип агрегата → topic, id → key). Низкая задержка, порядок коммитов, нет polling-нагрузки; можно вставлять и сразу удалять строку в той же транзакции — в WAL она есть, таблица пуста.</li>
<li>Минусы CDC: Kafka Connect, Debezium, replication slot — эксплуатация; неактивный слот удерживает WAL и может переполнить диск БД — нужен мониторинг.</li>
<li>Оба — at-least-once: consumers идемпотентны в любом случае.</li>
</ul>`
    },
    {
      id: 'kafka-037', chapter: 'errors', type: 'choice',
      q: `Consumer падает с исключением на сообщении с битыми данными, не сдвигая offset, и каждый раз перечитывает его. Как называется ситуация и каков правильный базовый ответ?`,
      options: [
        `Poison message; классифицировать ошибку как постоянную и отправить сообщение в DLQ с исходными байтами и диагностикой, затем сдвинуть offset`,
        `Rebalance storm; увеличить session.timeout.ms`,
        `Consumer lag; добавить partitions`,
        `Poison message; ретраить бесконечно с экспоненциальной задержкой прямо в цикле`
      ],
      answer: 0,
      explain: `Битые данные не исправятся повтором — бесконечные ретраи на месте навсегда останавливают partition. Постоянные ошибки уходят в DLQ сразу (с исходными байтами и заголовками-диагностикой), offset сдвигается, partition продолжает работу, а DLQ разбирают отдельно и при необходимости переотправляют.`
    },
    {
      id: 'kafka-038', chapter: 'errors', type: 'open',
      q: `Спроектируйте неблокирующие ретраи с задержкой на Kafka.`,
      answer: `<ul>
<li>Классифицировать ошибку: постоянная — сразу в DLQ; временная — в retry.</li>
<li>Цепочка topics с растущей задержкой: <code>x.retry.10s</code>, <code>x.retry.1m</code>, <code>x.retry.10m</code>, затем <code>x.dlq</code>. В заголовках — число попыток, исходные topic/partition/offset, «не раньше чем», ошибка.</li>
<li>Исходный offset сдвигается только после успешной записи в retry/DLQ — иначе потеря.</li>
<li>Retry-consumer не спит в обработчике (max.poll.interval): если сообщение не созрело — <code>Pause</code> partition, <code>Seek</code> на него и <code>Resume</code> по таймеру; так как retry topic упорядочен по времени, следующие тоже не созрели.</li>
<li>Цена — потеря порядка: парковать ключ (если ключ в ретрае, следующие его сообщения тоже в retry) или использовать версии событий.</li>
<li>Обработчики идемпотентны; алерты на размер DLQ; инструмент переотправки из DLQ.</li>
</ul>`
    },
    {
      id: 'kafka-039', chapter: 'errors', type: 'choice',
      q: `В каком случае блокирующий ретрай (с паузой чтения partition) правильнее, чем отправка в retry topic?`,
      options: [
        `Сообщение содержит невалидный JSON`,
        `Недоступна база данных, в которую пишет каждый обработчик сообщения`,
        `Нарушено бизнес-правило: заказ уже отменён`,
        `В сообщении нет обязательного поля`
      ],
      answer: 1,
      explain: `Если зависимость недоступна для всех сообщений, следующие тоже упадут — перекладывать поток в retry topics бессмысленно и вредно. Правильно остановиться: Pause partitions или circuit breaker, ретраи с backoff, продолжая вызывать Consume. Остальные варианты — постоянные ошибки конкретного сообщения, им место в DLQ.`
    },
    {
      id: 'kafka-040', chapter: 'errors', type: 'choice',
      q: `Consumer на Confluent.Kafka с JSON-десериализатором значения встретил сообщение в другом формате. Что произойдёт?`,
      options: [
        `Consume вернёт ConsumeResult с Value = null`,
        `librdkafka молча пропустит сообщение`,
        `Брокер вернёт сообщение в начало partition`,
        `Consume бросит ConsumeException с кодом Local_ValueDeserialization; сырые байты доступны через ex.ConsumerRecord`
      ],
      answer: 3,
      explain: `Ошибка десериализации — исключение из Consume, и если его не обработать, цикл падает и после рестарта читает то же сообщение. Нужно поймать ConsumeException, отправить ex.ConsumerRecord в DLQ и сохранить offset + 1 (для TopicPartitionOffset единицу прибавляют сами). Альтернатива — читать byte[] и десериализовать в своём коде.`
    },
    {
      id: 'kafka-041', chapter: 'errors', type: 'open',
      q: `Как сделать consumer, который не теряет и не дублирует сообщения при rolling deploy в Kubernetes?`,
      answer: `<ul>
<li>SIGTERM → отмена <code>stoppingToken</code>; цикл перестаёт брать новые сообщения, но <strong>доделывает текущее</strong> (не обрывать его тем же токеном посередине).</li>
<li>Сохранить offset обработанного (StoreOffset/Commit) и вызвать <code>consumer.Close()</code>: финальный коммит и штатный выход из группы — ребалансировка сразу, без ожидания session.timeout.</li>
<li>В <code>SetPartitionsRevokedHandler</code> дождаться сообщений отзываемых partitions и закоммитить; в <code>SetPartitionsLostHandler</code> не коммитить — partitions уже чужие.</li>
<li>Producer: <code>Flush</code>.</li>
<li>Таймауты: terminationGracePeriodSeconds больше HostOptions.ShutdownTimeout, тот больше худшего времени обработки.</li>
<li>Меньше ребалансировок: cooperative-sticky, static membership.</li>
<li>И всё равно идемпотентная обработка — kill -9 и OOM никто не отменял.</li>
</ul>`
    },
    {
      id: 'kafka-042', chapter: 'errors', type: 'open',
      q: `Вчера с 14:00 обработчик из-за бага неправильно сохранял данные. Баг исправлен. Как переобработать события?`,
      answer: `<p>Остановить все экземпляры группы (reset offsets требует неактивной группы), выполнить <code>kafka-consumer-groups.sh --group G --topic T --reset-offsets --to-datetime 2026-10-26T14:00:00.000</code> сначала без <code>--execute</code> (dry run), затем с ним, и запустить сервис. Из кода то же делается через <code>OffsetsForTimes</code> и Seek в обработчике назначения partitions. Альтернатива — отдельная группа, которая переобработает только нужный период.</p>
<p>Условия: события ещё в пределах retention; обработка идемпотентна (часть событий уже обработана правильно или неправильно — результат должен быть перезаписан, а не задвоен); побочные эффекты вроде писем и пушей в режиме replay отключить. Учесть часовой пояс в датах и что timestamp — CreateTime producer-а, если не настроен LogAppendTime.</p>`
    },
    {
      id: 'kafka-043', chapter: 'errors', type: 'choice',
      q: `Что правильно делать в SetPartitionsLostHandler?`,
      options: [
        `Синхронно закоммитить offsets потерянных partitions`,
        `Повторно назначить себе эти partitions через Assign`,
        `Остановить обработку сообщений этих partitions, не коммитя их offsets: они уже назначены другому consumer-у`,
        `Ничего, этот обработчик вызывается только при удалении topic`
      ],
      answer: 2,
      explain: `Lost означает, что partitions отобраны без штатной ребалансировки (например, consumer вылетел по max.poll.interval или session timeout) и уже могут обрабатываться другим участником. Коммит из этого состояния либо не пройдёт, либо перетрёт прогресс нового владельца. Коммитят в revoked-обработчике — при штатном отзыве.`
    },
    {
      id: 'kafka-044', chapter: 'schemas', type: 'choice',
      q: `Для subject в Schema Registry выставлен режим BACKWARD. В каком порядке выкатывать изменение схемы?`,
      options: [
        `Сначала producers, потом consumers`,
        `Одновременно, иначе всё сломается`,
        `Порядок не важен`,
        `Сначала consumers, потом producers: новая схема умеет читать данные, записанные старой`
      ],
      answer: 3,
      explain: `BACKWARD: читатель с новой схемой читает данные старой. Значит, сначала обновляют consumers (они начинают понимать оба варианта), потом producers начинают писать по новой схеме. FORWARD — наоборот, сначала producers. Порядок не важен только при FULL.`
    },
    {
      id: 'kafka-045', chapter: 'schemas', type: 'open',
      q: `Нужно добавить в событие OrderCreated обязательное поле deliveryRegion. Как сделать это, не сломав потребителей?`,
      answer: `<p>Одним шагом — никак: старые сообщения в логе поля не имеют, а старые producers какое-то время продолжат его не заполнять. План:</p>
<ol>
<li>Добавить поле как необязательное (с default в Avro, <code>optional</code> в Protobuf, nullable в JSON) — изменение совместимое, registry его пропустит.</li>
<li>Обновить producers, чтобы всегда его заполняли.</li>
<li>Consumers обрабатывают отсутствие поля (старые сообщения, replay): значение по умолчанию или вычисление из других данных.</li>
<li>Когда в логе не осталось сообщений без поля (прошёл retention) и replay не нужен со старых данных, consumers могут считать его обязательным в своей логике.</li>
</ol>
<p>Если смысл события меняется, честнее новая версия события или новый topic с периодом dual publish.</p>`
    },
    {
      id: 'kafka-046', chapter: 'schemas', type: 'choice',
      q: `Из Protobuf-схемы события нужно удалить поле <code>string comment = 7;</code>. Как правильно?`,
      options: [
        `Удалить поле и объявить <code>reserved 7;</code> и <code>reserved "comment";</code>, чтобы номер не переиспользовали`,
        `Удалить поле и при следующем добавлении поля использовать номер 7`,
        `Поменять тип поля на bytes, чтобы старые consumers его игнорировали`,
        `Удалять поля в Protobuf нельзя никогда`
      ],
      answer: 0,
      explain: `На проводе поле идентифицирует номер. Переиспользовать 7 под другое поле опасно: старые данные или старые producers с comment будут прочитаны как новое поле. Смена типа — ломающее изменение. Удалять можно, если номер и имя зарезервированы, а consumers не зависят от поля.`
    },
    {
      id: 'kafka-047', chapter: 'schemas', type: 'choice',
      q: `Как consumer, использующий Schema Registry, узнаёт, какой схемой записано сообщение?`,
      options: [
        `Схема передаётся целиком в заголовке каждого сообщения`,
        `По имени topic — для topic всегда одна текущая схема`,
        `В начале value записаны magic byte и 4-байтовый schema id; десериализатор загружает схему по id и кэширует`,
        `Consumer всегда читает последнюю версию схемы из registry`
      ],
      answer: 2,
      explain: `Wire format Confluent: байт 0, затем schema id (4 байта), затем данные (для Protobuf ещё индексы message-типов). Поэтому в topic могут одновременно лежать сообщения разных версий, и каждое читается своей схемой писателя — это и позволяет эволюцию. Схема целиком в каждом сообщении была бы слишком дорогой.`
    },
    {
      id: 'kafka-048', chapter: 'schemas', type: 'open',
      q: `Чем событие отличается от команды? Thin или fat events — что выбрать?`,
      answer: `<p><strong>Событие</strong> — факт в прошедшем времени (<code>OrderCreated</code>): отправитель не знает получателей, получатель не может «отказаться» от факта, один producer — много consumers. <strong>Команда</strong> — просьба (<code>ValidateOrder</code>): конкретный адресат, может отказать (ответным событием), сильнее связывает сервисы. Путать их опасно: «событие» SendEmail на деле команда.</p>
<p><strong>Thin event</strong> — «заказ 123 изменился», детали по API: маленький контракт, свежие данные, но обратная синхронная зависимость, нагрузка на источник, гонки. <strong>Fat event (ECST)</strong> — событие несёт состояние: потребители автономны, строят проекции, replay восстанавливает состояние; но контракт больше и труднее меняется, утекает внутренняя модель. Обычно компромисс: данные, нужные типичным потребителям, плюс id; для compacted topics состояния — fat.</p>`
    },
    {
      id: 'kafka-049', chapter: 'schemas', type: 'choice',
      q: `События заказа публикуются в три topic: orders.created, orders.paid, orders.shipped, все с key = orderId. Consumer подписан на все три. Гарантирован ли порядок Created → Paid → Shipped для одного заказа?`,
      options: [
        `Да, ключ одинаковый, значит partition одна и та же`,
        `Нет: это разные topics, между ними порядка нет; для гарантии нужен один topic с ключом orderId`,
        `Да, если у всех трёх topic одинаковое число partitions`,
        `Да, если consumer один в группе`
      ],
      answer: 1,
      explain: `Partition — часть конкретного topic. Partition 3 topic-а created и partition 3 topic-а paid — разные логи, consumer читает их независимо, и Paid вполне может быть получен раньше Created. Порядок между типами событий одной сущности обеспечивают одним topic (и subject strategy, допускающей несколько типов).`
    },
    {
      id: 'kafka-050', chapter: 'dotnet', type: 'choice',
      q: `Чтобы ускорить обработку, разработчик запускает 8 задач, каждая вызывает <code>consumer.Consume()</code> у одного и того же экземпляра IConsumer. Оценка?`,
      options: [
        `Нормально: IConsumer потокобезопасен, и это рекомендуемый способ`,
        `Нормально, но нужно включить EnableAutoCommit`,
        `Нормально при CooperativeSticky`,
        `Неправильно: Consume, Commit, StoreOffset и Seek вызывают из одного потока; параллелизм — через воркеры, которым поток consumer-а раздаёт сообщения`
      ],
      answer: 3,
      explain: `IConsumer не рассчитан на параллельный Consume: порядок, учёт offsets и обработчики ребалансировки (вызываются внутри Consume) ломаются. Один поток читает, раздаёт сообщения воркерам (по ключу, если важен порядок) и сам сохраняет offsets. Потокобезопасен как singleton — IProducer.`
    },
    {
      id: 'kafka-051', chapter: 'dotnet', type: 'open',
      q: `Как правильно хостить Kafka consumer в ASP.NET Core?`,
      answer: `<ul>
<li><code>BackgroundService</code>; блокирующий цикл <code>Consume</code> — в отдельном long-running потоке (<code>Task.Factory.StartNew(..., LongRunning)</code> или Task.Run), чтобы не блокировать старт хоста — исторически ExecuteAsync выполнялся синхронно до первого await.</li>
<li>Scope DI на сообщение или batch: hosted service — singleton, DbContext — scoped.</li>
<li>Обработка ошибок внутри цикла: необработанное исключение по умолчанию останавливает хост, и poison message превратит сервис в CrashLoop — нужны DLQ и классификация.</li>
<li>Offsets: EnableAutoOffsetStore=false, StoreOffset после обработки, автокоммит.</li>
<li>Остановка: обработка отмены, доделать текущее, <code>Close()</code> в finally; producer — singleton с Flush при остановке.</li>
<li>Обработчики ошибок, логов, статистики и ребалансировки; health check, отражающий, что consumer жив и получает partitions.</li>
<li>Логика обработки — в отдельном классе, тестируемом без Kafka.</li>
</ul>`
    },
    {
      id: 'kafka-052', chapter: 'dotnet', type: 'choice',
      q: `В конструктор BackgroundService-consumer-а внедрён DbContext. Какая проблема?`,
      options: [
        `Никакой, DbContext потокобезопасен и может жить вечно`,
        `Hosted service — singleton, а DbContext — scoped: получится один контекст на всё время жизни (или ошибка валидации scope), трекинг растёт, ошибки одного сообщения портят следующие`,
        `DbContext нельзя использовать вместе с Kafka`,
        `EF Core не поддерживает асинхронные вызовы в фоновых сервисах`
      ],
      answer: 1,
      explain: `Правильно — IServiceScopeFactory и scope на сообщение (или batch): свежий DbContext, свои транзакции и чистый change tracker. «Вечный» DbContext накапливает отслеживаемые сущности, держит соединение и не потокобезопасен.`
    },
    {
      id: 'kafka-053', chapter: 'dotnet', type: 'open',
      q: `Как протянуть distributed tracing через Kafka в .NET?`,
      answer: `<p>Trace context передаётся в заголовках сообщения по W3C (<code>traceparent</code>, <code>tracestate</code>). На producer-е: начать <code>Activity</code> с <code>ActivityKind.Producer</code> и через <code>Propagators.DefaultTextMapPropagator.Inject</code> записать контекст в <code>Headers</code>. На consumer-е: <code>Extract</code> из заголовков (<code>TryGetLastBytes</code>) и начать <code>Activity</code> с <code>ActivityKind.Consumer</code> и извлечённым родителем. Атрибуты по semantic conventions для messaging: <code>messaging.system=kafka</code>, destination, partition, offset, consumer group. Для batch-обработки — links на контексты сообщений вместо одного родителя. ActivitySource регистрируется в OpenTelemetry (<code>AddSource</code>), иначе span-ы не экспортируются. Есть contrib-пакет инструментирования для Confluent.Kafka, но механику надо понимать. Плюс correlation id в scope логгера.</p>`
    },
    {
      id: 'kafka-054', chapter: 'dotnet', type: 'choice',
      q: `Интеграционный тест на Testcontainers: тест отправляет сообщение, затем запускает consumer новой группы и ждёт сообщение — тест иногда падает по таймауту. Наиболее вероятная причина?`,
      options: [
        `Testcontainers не поддерживает consumer groups`,
        `Сообщение отправлено до того, как группа получила partitions, а auto.offset.reset=latest (по умолчанию) — consumer начал с конца и пропустил его`,
        `Kafka в контейнере не хранит сообщения дольше секунды`,
        `Producer в тестах нельзя создавать до consumer-а`
      ],
      answer: 1,
      explain: `У новой группы нет committed offset, и при latest consumer видит только сообщения, пришедшие после назначения partitions, а ребалансировка занимает время. В тестах ставят AutoOffsetReset.Earliest, уникальные topic и group.id на тест и ждут результат с таймаутом и опросом.`
    },
    {
      id: 'kafka-055', chapter: 'comparison', type: 'open',
      q: `Чем Kafka отличается от RabbitMQ? Когда что выбрать?`,
      answer: `<p><strong>Модель</strong>: RabbitMQ — брокер очередей (exchanges, bindings, queues), push с prefetch, ack каждого сообщения, подтверждённое удаляется; Kafka — лог с retention, pull, у группы один offset на partition, replay.</p>
<p><strong>Следствия</strong>: в Kafka много независимых потребителей читают одни данные, порядок по ключу, огромный throughput, но параллелизм ограничен partitions и нельзя подтвердить одно сообщение — ретраи и DLQ строятся вручную. В RabbitMQ — богатая маршрутизация, TTL, DLX, приоритеты, задержки, конкурирующие consumers без ограничения, равномерное распределение долгих задач; replay только в Streams; порядок нарушается при конкурирующих consumers и redelivery.</p>
<p><strong>Выбор</strong>: Kafka — шина событий между доменами, стриминг, CDC, event sourcing, высокие объёмы, нужен replay. RabbitMQ — очереди фоновых задач разной длительности, RPC, сложная маршрутизация. В крупных компаниях часто есть оба.</p>`
    },
    {
      id: 'kafka-056', chapter: 'comparison', type: 'choice',
      q: `Нужна очередь задач генерации отчётов: задачи независимые, длятся от 2 секунд до 20 минут, воркеров 30, порядок не важен, после выполнения задача не нужна. Что подходит лучше и почему?`,
      options: [
        `Kafka: высокий throughput решает всё`,
        `Kafka с compacted topic: последняя задача по ключу сохранится`,
        `Redis Pub/Sub: самый простой вариант`,
        `Очередь RabbitMQ с prefetch=1 и ack после выполнения: долгая задача не блокирует остальные, воркеры получают задачи по мере освобождения`
      ],
      answer: 3,
      explain: `В Kafka 20-минутная задача держит всю partition (последовательная обработка), а параллелизм ограничен числом partitions и неравномерен. Очередь с ack по сообщению и prefetch=1 естественно балансирует долгие задачи между воркерами. Redis Pub/Sub не хранит сообщения — офлайн-воркер их потеряет. Share groups (production-ready с Kafka 4.2) нацелены именно на этот сценарий, но их поддержку в используемом клиенте надо проверять.`
    },
    {
      id: 'kafka-057', chapter: 'comparison', type: 'choice',
      q: `Можно ли в RabbitMQ перечитать сообщения, которые уже были подтверждены?`,
      options: [
        `Да, в любой очереди через сдвиг offset`,
        `Нет, никогда: RabbitMQ не хранит сообщения после ack`,
        `В classic и quorum очередях — нет, подтверждённое удаляется; в RabbitMQ Streams — да, чтение с offset в пределах retention`,
        `Да, через dead letter exchange`
      ],
      answer: 2,
      explain: `Обычные очереди удаляют сообщение после ack. RabbitMQ Streams (с 3.9) — log-структура с retention и чтением с произвольного offset, то есть replay в RabbitMQ есть, но это отдельный тип. DLX получает отвергнутые и просроченные сообщения, а не подтверждённые.`
    },
    {
      id: 'kafka-058', chapter: 'comparison', type: 'open',
      q: `На собеседовании просят выбрать брокер для интеграции сервиса заказов с сервисом проверки заказов другого домена. Как вы будете рассуждать?`,
      answer: `<p>От требований: (1) характер — поток событий заказов, которые нужны не одному потребителю (проверка, склад, уведомления, аналитика) и будут нужны новым; (2) порядок — по заказу важен; (3) нужен replay после инцидента или бага в проверке; (4) объём — высокий в пиковые распродажи; (5) домены деплоятся независимо — нужен контракт со схемой и проверкой совместимости.</p>
<p>Вывод — Kafka: topic событий заказов с key = orderId, outbox на стороне заказов, идемпотентный consumer с inbox у проверки, результат проверки — в свой topic с тем же ключом, correlation id в заголовках, таймауты и компенсации на стороне инициатора, DLQ и retry topics, мониторинг lag. Оговорить, где был бы уместен RabbitMQ: внутренние фоновые задачи сервиса разной длительности.</p>`
    },
    {
      id: 'kafka-059', chapter: 'comparison', type: 'choice',
      q: `Какой главный риск Redis Streams как основной шины событий между доменами?`,
      options: [
        `Данные ограничены оперативной памятью, а репликация асинхронная — при failover последние записи могут потеряться; масштаб одного стрима ограничен`,
        `Redis Streams не поддерживает consumer groups`,
        `Redis Streams не позволяет подтверждать сообщения`,
        `Redis Streams доставляет сообщения только одному подписчику во всей системе`
      ],
      answer: 0,
      explain: `Consumer groups (XREADGROUP), подтверждения (XACK) и pending entries list в Redis Streams есть. Ограничения в другом: объём в RAM, асинхронная репликация и меньшая зрелость как долгосрочного хранилища событий. Для небольших внутренних очередей это нормальный выбор, для шины компании — Kafka.`
    }
  ]
});
