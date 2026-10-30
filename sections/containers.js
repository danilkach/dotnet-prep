window.PREP = window.PREP || [];
window.PREP.push({
  id: 'containers',
  title: 'Docker и Kubernetes',
  chapters: [
    {
      id: 'inside',
      title: 'Контейнеры изнутри',
      html: `
<h3>Контейнер — это процесс, а не маленькая виртуальная машина</h3>
<p>Самая частая ошибка в ответах — описывать контейнер как «лёгкую виртуалку». Виртуальная машина эмулирует железо: у неё свой виртуальный CPU, своя память, свой BIOS/UEFI и, главное, <strong>своё ядро</strong>. Гипервизор (KVM, Hyper-V, VMware ESXi) делит физическую машину между несколькими полноценными операционными системами. Загрузка ВМ — это загрузка ОС, десятки секунд; образ ВМ весит гигабайты, потому что содержит всю систему.</p>
<p>Контейнер — это <strong>обычный процесс Linux</strong> на ядре хоста, которому ядро ограничило кругозор и аппетит. Если на хосте выполнить <code>ps aux</code>, процесс <code>dotnet Polestar.dll</code> из контейнера будет виден в общем списке, с другим PID. Своего ядра у контейнера нет, поэтому:</p>
<ul>
<li>старт измеряется миллисекундами (запуск процесса), а не секундами;</li>
<li>накладные расходы на CPU и память близки к нулю — нет эмуляции;</li>
<li>образ содержит только userspace: файлы приложения, рантайм, нужные библиотеки;</li>
<li>изоляция слабее: уязвимость ядра или неправильная конфигурация (privileged, монтирование docker.sock) дают выход на хост;</li>
<li>Linux-контейнер требует Linux-ядро. Docker Desktop на Windows и macOS запускает лёгкую Linux-ВМ (WSL 2 или аналог), и контейнеры живут внутри неё.</li>
</ul>
<p>Изоляцию контейнера обеспечивают два механизма ядра: <strong>namespaces</strong> отвечают за то, что процесс <em>видит</em>, <strong>cgroups</strong> — за то, сколько он может <em>потребить</em>. Третий кирпич — файловая система образа, собранная из слоёв. Всё остальное (Docker, containerd, Kubernetes) — инструменты, которые удобно настраивают эти три вещи.</p>
<p>Для мультитенантной среды с недоверенным кодом обычной контейнерной изоляции бывает мало. Тогда используют песочницы с отдельным ядром: gVisor (ядро в userspace, перехватывающее системные вызовы) или Kata Containers и Firecracker (микро-ВМ, которые выглядят для оркестратора как контейнеры). Для собственного кода компании обычно хватает обычных контейнеров плюс запрет привилегий.</p>

<h3>Namespaces: что процесс видит</h3>
<p>Namespace — это механизм ядра, который даёт группе процессов собственный экземпляр какого-то глобального ресурса. Основные виды:</p>
<table>
<thead><tr><th>Namespace</th><th>Что изолирует</th></tr></thead>
<tbody>
<tr><td><code>pid</code></td><td>Номера процессов. Внутри контейнера приложение видит себя PID 1 и не видит процессы хоста</td></tr>
<tr><td><code>net</code></td><td>Сетевые интерфейсы, IP-адреса, таблицы маршрутизации, порты. Два контейнера могут слушать 8080 одновременно</td></tr>
<tr><td><code>mnt</code></td><td>Точки монтирования: у контейнера своё дерево файловой системы с корнем в образе</td></tr>
<tr><td><code>uts</code></td><td>Hostname и domain name</td></tr>
<tr><td><code>ipc</code></td><td>System V IPC, POSIX message queues, разделяемая память</td></tr>
<tr><td><code>user</code></td><td>UID/GID: root внутри может быть непривилегированным пользователем снаружи (rootless)</td></tr>
<tr><td><code>cgroup</code></td><td>Видимое дерево cgroups: контейнер видит свою группу как корень</td></tr>
<tr><td><code>time</code></td><td>Смещения монотонных часов (появился позже остальных, используется редко)</td></tr>
</tbody>
</table>
<p>Namespaces можно <strong>разделять</strong> между процессами. Именно так устроен Pod в Kubernetes: все контейнеры пода живут в одном <code>net</code>-namespace (поэтому достучаться до соседа можно по <code>localhost</code>), а <code>mnt</code> у каждого свой. Для этого kubelet сначала создаёт крошечный «pause»-контейнер, который держит общие namespaces, и подключает к ним контейнеры приложения. Флаг <code>shareProcessNamespace: true</code> в спецификации пода объединяет и <code>pid</code>-namespace — тогда контейнеры видят процессы друг друга, что удобно для отладочных sidecar-ов.</p>
<p>Посмотреть namespaces процесса можно в <code>/proc/&lt;pid&gt;/ns/</code>, а войти в них — утилитой <code>nsenter</code>. Именно этим, по сути, занимается <code>docker exec</code>: запускает новый процесс в namespaces уже работающего контейнера.</p>

<h3>cgroups: сколько процесс может потребить</h3>
<p><strong>Control groups</strong> — иерархия групп процессов, к которым ядро применяет лимиты и учёт ресурсов. Контроллеры:</p>
<ul>
<li><strong>cpu</strong> — доля процессора. Два механизма: <em>веса</em> (<code>cpu.weight</code> в v2, <code>cpu.shares</code> в v1) — относительный приоритет при конкуренции, и <em>квота</em> (<code>cpu.max</code> в v2: «не больше X микросекунд за период Y», обычно период 100 мс). Квота — это жёсткий потолок, при его достижении процесс <strong>троттлится</strong> до конца периода.</li>
<li><strong>memory</strong> — лимит памяти (<code>memory.max</code>). При превышении ядро пытается вытеснить page cache, а если не получается — OOM killer убивает процесс внутри группы. Docker и Kubernetes видят это как exit code 137 и причину <code>OOMKilled</code>.</li>
<li><strong>pids</strong> — максимальное число процессов и потоков, защита от fork-бомбы.</li>
<li><strong>io</strong> — ограничение дискового ввода-вывода.</li>
</ul>
<p>Есть две версии. В <strong>cgroup v1</strong> у каждого контроллера своя иерархия, файлы лежат в <code>/sys/fs/cgroup/memory/...</code>, <code>/sys/fs/cgroup/cpu/...</code>. В <strong>cgroup v2</strong> иерархия единая, а интерфейс чище (<code>memory.max</code>, <code>cpu.max</code>, <code>memory.events</code>). Современные дистрибутивы и Kubernetes используют v2 по умолчанию; поддержка v2 в Kubernetes стабильна с 1.25. Для .NET важно, что рантайм читает обе версии: он узнаёт лимит памяти и CPU-квоту из cgroup и подстраивает под них GC и <code>Environment.ProcessorCount</code> (подробно — в главе «.NET в контейнере»).</p>
<p>Ключевая мысль для собеседования: cgroups — это не «виртуальная память размером с лимит». Процесс видит всю память хоста через <code>/proc/meminfo</code> и команду <code>free</code>, но ядро не даст ему занять больше лимита. Поэтому приложение, которое само не читает cgroup, может решить, что у него 64 ГБ, и быть убитым на 512 МБ. Старые JVM этим славились; .NET умеет читать cgroup с версии Core 3.0.</p>

<h3>Образ: слои, манифест, digest</h3>
<p><strong>Образ</strong> (image) — это неизменяемый шаблон файловой системы плюс метаданные для запуска. Физически он состоит из:</p>
<ul>
<li><strong>слоёв</strong> (layers) — tar-архивов с изменениями файловой системы. Каждый слой — это разница относительно предыдущего: какие файлы добавлены, изменены, удалены;</li>
<li><strong>конфигурации</strong> — JSON с переменными окружения, <code>Entrypoint</code>, <code>Cmd</code>, рабочим каталогом, пользователем, открытыми портами, историей сборки;</li>
<li><strong>манифеста</strong> — JSON, который перечисляет конфигурацию и слои по их digest.</li>
</ul>
<p>Всё адресуется по содержимому: <strong>digest</strong> — это SHA-256 от байтов объекта (<code>sha256:3f4a…</code>). Одинаковый слой, использованный в десяти образах, хранится и скачивается один раз. Поэтому у образов на одном базовом <code>aspnet</code> общая часть уже лежит на узле, и pull нового релиза качает только верхние слои с вашей DLL.</p>
<p><strong>Тег</strong> (<code>myapp:1.4.2</code>, <code>:latest</code>) — это изменяемый указатель на манифест. Тот же тег завтра может указывать на другой образ: так работают плавающие теги базовых образов (<code>aspnet:9.0</code> обновляется с каждым патчем). <strong>Digest неизменяем</strong>: <code>myapp@sha256:…</code> всегда означает ровно те же байты. Для воспроизводимых деплоев в манифестах и GitOps-репозиториях фиксируют конкретный тег сборки (а в строгих средах — digest), но никогда не <code>latest</code>.</p>
<p>Для нескольких архитектур существует <strong>image index</strong> (он же manifest list): один тег указывает на список манифестов для <code>linux/amd64</code>, <code>linux/arm64</code> и т. д., и клиент сам выбирает подходящий. Именно поэтому <code>docker pull mcr.microsoft.com/dotnet/aspnet:9.0</code> на Mac с Apple Silicon скачивает arm64-вариант.</p>
<p>Слой появляется от каждой инструкции Dockerfile, которая меняет файловую систему (<code>RUN</code>, <code>COPY</code>, <code>ADD</code>). Важное следствие: удаление файла в следующем слое <strong>не уменьшает образ</strong> — файл остаётся в нижнем слое, а сверху лишь помечается удалённым. Если в одном <code>RUN</code> скачать архив, а в следующем удалить, архив навсегда останется в образе (и его можно извлечь — это и утечка секретов, и лишний вес).</p>

<h3>Union filesystem: overlayfs и copy-up</h3>
<p>Как из стопки слоёв получается одна файловая система? Через <strong>union mount</strong>, в современном Docker и containerd — драйвер <strong>overlay2</strong> на основе ядерного <code>overlayfs</code>. У него четыре каталога:</p>
<ul>
<li><code>lowerdir</code> — слои образа, только чтение, сложенные стопкой;</li>
<li><code>upperdir</code> — тонкий записываемый слой конкретного контейнера;</li>
<li><code>workdir</code> — служебный каталог overlayfs;</li>
<li><code>merged</code> — то, что видит процесс: объединённое дерево.</li>
</ul>
<p>Чтение идёт сверху вниз: файл берётся из самого верхнего слоя, где он есть. При первой <strong>записи</strong> в файл из нижнего слоя происходит <strong>copy-up</strong>: файл целиком копируется в <code>upperdir</code> и дальше меняется там. Для большого файла (например, файла базы данных) первая запись дорогая. Удаление создаёт в <code>upperdir</code> специальный <strong>whiteout</strong>-файл, который «закрывает» нижнюю версию.</p>
<p>Практические выводы:</p>
<ul>
<li>Записываемый слой живёт столько, сколько контейнер. <code>docker rm</code> — и всё записанное пропало. Данные, которые должны пережить пересоздание (PostgreSQL, MinIO), хранят в <strong>volumes</strong>, которые монтируются мимо overlayfs.</li>
<li>Писать много в файловую систему контейнера медленнее, чем в volume, и это расходует диск узла. В Kubernetes активная запись в контейнерный слой или <code>emptyDir</code> учитывается как <em>ephemeral storage</em> и может привести к вытеснению пода.</li>
<li>Десять контейнеров одного образа делят нижние слои — на диске и в page cache они хранятся один раз.</li>
<li>Хорошая практика — запускать контейнер с read-only корнем (<code>readOnlyRootFilesystem: true</code> в K8s) и монтировать записываемые каталоги (<code>/tmp</code>) явно. Так злоумышленник не сможет докачать инструменты, а вы сразу увидите, если приложение пишет куда не ожидалось.</li>
</ul>

<h3>OCI, runtime-стек и registry</h3>
<p><strong>Open Container Initiative</strong> стандартизировала три вещи, благодаря которым образ, собранный Docker, запускается в Kubernetes с containerd, а образ, собранный <code>dotnet publish</code> без Docker, кладётся в любой registry:</p>
<ul>
<li><strong>Image Spec</strong> — формат манифеста, конфигурации, слоёв, индекса;</li>
<li><strong>Runtime Spec</strong> — как распакованный bundle (корневая ФС + <code>config.json</code>) превращается в работающий контейнер. Эталонная реализация — <code>runc</code>;</li>
<li><strong>Distribution Spec</strong> — HTTP API registry: push и pull слоёв и манифестов.</li>
</ul>
<p>Стек запуска выглядит так. Сверху — инструмент или оркестратор (Docker CLI, kubelet). Ниже — <strong>высокоуровневый runtime</strong>: containerd или CRI-O. Он скачивает образы, управляет снапшотами файловой системы, сетью и жизненным циклом. Ещё ниже — <strong>низкоуровневый runtime</strong> (<code>runc</code>, <code>crun</code>), который делает системные вызовы: создаёт namespaces, cgroups, монтирует ФС и запускает процесс. Kubernetes общается с высокоуровневым runtime через <strong>CRI</strong> (Container Runtime Interface).</p>
<p>Отсюда классический вопрос: «Kubernetes отказался от Docker — образы теперь надо собирать иначе?» Нет. В версии 1.24 из kubelet удалили <em>dockershim</em> — прослойку, позволявшую использовать Docker Engine как runtime. Узлы теперь работают на containerd или CRI-O напрямую. Образы, собранные Docker, — это обычные OCI-образы, и они запускаются как раньше. Сам Docker Engine внутри тоже использует containerd.</p>
<p><strong>Registry</strong> хранит образы: Docker Hub, GitHub Container Registry, GitLab Registry, Harbor, Nexus, облачные (Yandex Container Registry и т. д.). Что стоит знать:</p>
<ul>
<li>Docker Hub ограничивает частоту анонимных pull, и кластер, который при каждом рестарте тянет базовые образы оттуда, может упереться в лимит. Компании держат зеркало или pull-through cache (Harbor, Nexus).</li>
<li>Приватный registry требует аутентификации: в Kubernetes это <code>imagePullSecrets</code> пода или сервисного аккаунта.</li>
<li><code>imagePullPolicy: Always</code> не значит «скачать заново все слои» — kubelet сверяет digest, и если он не изменился, ничего не качается. Для изменяемого тега <code>Always</code> гарантирует свежую версию; для неизменяемых тегов разумно <code>IfNotPresent</code>.</li>
</ul>

<h3>Жизненный цикл контейнера</h3>
<p>Состояния контейнера в Docker: <strong>created</strong> (файловая система и конфигурация готовы, процесс не запущен), <strong>running</strong>, <strong>paused</strong> (процессы заморожены через freezer cgroup), <strong>exited</strong> (процесс завершился, контейнер с записываемым слоем остаётся до удаления), <strong>dead</strong> (не удалось корректно остановить или удалить). <code>docker run</code> = <code>create</code> + <code>start</code>.</p>
<p>Контейнер живёт, пока жив его <strong>главный процесс</strong> (PID 1 в его namespace). Завершился <code>dotnet</code> — контейнер перешёл в exited, даже если внутри оставались другие процессы: они будут убиты. Отсюда и анти-паттерн «запустить приложение в фоне и сделать <code>tail -f /dev/null</code>» — тогда контейнер переживёт падение приложения, и никто об этом не узнает.</p>
<p>Остановка: <code>docker stop</code> отправляет главному процессу <strong>SIGTERM</strong> (или сигнал из <code>STOPSIGNAL</code> образа), ждёт таймаут (по умолчанию 10 секунд, флаг <code>-t</code>) и затем отправляет <strong>SIGKILL</strong>. <code>docker kill</code> сразу шлёт SIGKILL. SIGKILL нельзя перехватить: нет ни закрытия соединений, ни сброса буферов логов, ни завершения обработки сообщений.</p>
<p>Коды выхода, которые нужно узнавать с первого взгляда:</p>
<table>
<thead><tr><th>Код</th><th>Значение</th></tr></thead>
<tbody>
<tr><td>0</td><td>Нормальное завершение</td></tr>
<tr><td>1</td><td>Ошибка приложения: процесс сам вернул 1 (например, <code>Main</code> поймал исключение старта и вернул 1; во многих рантаймах так завершается и необработанное исключение)</td></tr>
<tr><td>125–127</td><td>Проблема самого запуска: ошибка Docker, команда не исполняется, команда не найдена</td></tr>
<tr><td>128 + N</td><td>Процесс убит сигналом N</td></tr>
<tr><td>137</td><td>128 + 9, SIGKILL: OOM killer или принудительная остановка после таймаута</td></tr>
<tr><td>143</td><td>128 + 15, SIGTERM, который процесс не обработал сам</td></tr>
<tr><td>134</td><td>128 + 6, SIGABRT: аварийное завершение рантайма; .NET на Linux обычно завершается так при необработанном исключении</td></tr>
<tr><td>139</td><td>128 + 11, SIGSEGV: segmentation fault в нативном коде</td></tr>
</tbody>
</table>
<p>Политики перезапуска в Docker: <code>no</code>, <code>on-failure[:N]</code>, <code>always</code>, <code>unless-stopped</code>. В Kubernetes перезапуском управляет kubelet по <code>restartPolicy</code> пода (у Deployment — всегда <code>Always</code>) с экспоненциальной задержкой — это и есть <code>CrashLoopBackOff</code>.</p>

<h3>PID 1 и сигналы</h3>
<p>Процесс с PID 1 в своём pid-namespace особенный, и это источник реальных инцидентов.</p>
<p><strong>Первая особенность — сигналы.</strong> Для обычного процесса у SIGTERM есть действие по умолчанию: завершиться. Для PID 1 ядро действия по умолчанию <strong>не применяет</strong>: если процесс не установил обработчик, SIGTERM и SIGINT просто игнорируются. (SIGKILL от родительского namespace по-прежнему работает — так <code>docker stop</code> и добивает такой контейнер через 10 секунд.) Симптом: контейнер «долго останавливается» ровно на величину таймаута и завершается кодом 137.</p>
<p>.NET-приложение на Generic Host обработчик устанавливает: <code>ConsoleLifetime</code> подписывается на SIGTERM, SIGINT и SIGQUIT и запускает корректную остановку хоста. Поэтому <code>dotnet</code> в роли PID 1 работает правильно — <strong>если он действительно PID 1</strong>.</p>
<p><strong>Вторая особенность — shell form.</strong> Инструкция в форме строки</p>
<pre><code>ENTRYPOINT dotnet Polestar.dll</code></pre>
<p>превращается в <code>/bin/sh -c "dotnet Polestar.dll"</code>. PID 1 становится shell, а <code>dotnet</code> — его дочерним процессом. Многие shell не пересылают сигналы детям, и SIGTERM уходит в никуда (некоторые оболочки делают <code>exec</code> для единственной команды, но полагаться на это нельзя). К тому же в chiseled- и distroless-образах shell просто нет, и такая инструкция не запустится. Правильно — <strong>exec form</strong>:</p>
<pre><code>ENTRYPOINT ["dotnet", "Polestar.dll"]</code></pre>
<p>Если перед стартом нужен скрипт (подставить переменные, дождаться чего-то), он должен заканчиваться на <code>exec dotnet Polestar.dll</code>, чтобы заменить shell процессом приложения.</p>
<p><strong>Третья особенность — зомби.</strong> Когда процесс-родитель умирает, его дети переходят к PID 1, и именно PID 1 обязан «пожинать» (<code>wait()</code>) завершившихся потомков. Приложение, не рассчитанное на роль init, этого не делает, и в таблице процессов копятся зомби. Для веб-API, не запускающего дочерних процессов, это не проблема; для сервиса, который вызывает внешние утилиты (ImageMagick CLI, ffmpeg, git), — проблема. Решение — маленький init: <code>tini</code> или <code>dumb-init</code> в качестве ENTRYPOINT, либо <code>docker run --init</code> / <code>init: true</code> в Compose. Init пересылает сигналы приложению и собирает зомби.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Чем контейнер отличается от виртуальной машины?»</summary>
<p>Виртуальная машина виртуализирует железо и запускает собственное ядро ОС поверх гипервизора; контейнер — это обычный процесс на ядре хоста, изолированный механизмами ядра. Изоляция видимости делается через namespaces (pid, net, mnt, uts, ipc, user), ограничение ресурсов — через cgroups, а файловая система собирается из слоёв образа через overlayfs. Отсюда старт за миллисекунды, почти нулевые накладные расходы и образы в десятки мегабайт вместо гигабайт. Обратная сторона — общая поверхность атаки через ядро: уязвимость ядра или привилегированный контейнер дают выход на хост. Для недоверенного кода используют песочницы с отдельным ядром — gVisor, Kata Containers, Firecracker. И Linux-контейнер требует Linux-ядро: на Windows и macOS Docker Desktop держит для этого Linux-ВМ.</p>
</details>
<details><summary>«Что такое namespaces и cgroups? Приведите примеры»</summary>
<p>Namespaces определяют, что процесс видит: собственные номера процессов (pid), сетевые интерфейсы и порты (net), дерево монтирования (mnt), hostname (uts), IPC, отображение UID (user), видимое дерево cgroups. Cgroups определяют, сколько процесс может потребить: квоту и веса CPU, лимит памяти, число процессов, I/O. Пример namespaces — два контейнера одновременно слушают порт 8080, потому что у каждого свой сетевой стек. Пример cgroups — контейнер с лимитом 512 МБ убивается OOM killer-ом с кодом 137, хотя на хосте 64 ГБ свободны. В поде Kubernetes контейнеры разделяют net-namespace, поэтому общаются через localhost, но у каждого своя файловая система.</p>
</details>
<details><summary>«Из чего состоит образ? Что такое слой и digest?»</summary>
<p>Образ — это манифест, конфигурация и набор слоёв. Слой — tar-архив изменений файловой системы относительно предыдущего; конфигурация хранит Entrypoint, Cmd, переменные окружения, пользователя, рабочий каталог. Каждый объект адресуется SHA-256 от своего содержимого — это digest, поэтому одинаковые слои хранятся и скачиваются один раз. Тег — изменяемый указатель на манифест, digest — неизменяемый. Для мультиархитектурных образов тег указывает на image index со списком манифестов под разные платформы. Важное следствие слоистости: удаление файла в следующем слое не уменьшает образ и не убирает из него секрет.</p>
</details>
<details><summary>«Как работает overlayfs? Почему данные базы нельзя держать в контейнере?»</summary>
<p>Overlayfs объединяет read-only слои образа (lowerdir) и тонкий записываемый слой контейнера (upperdir) в одно дерево (merged). Чтение берёт файл из самого верхнего слоя, где он есть; первая запись в файл из нижнего слоя копирует его целиком в upperdir (copy-up); удаление создаёт whiteout-файл. Записываемый слой живёт столько же, сколько контейнер, — при пересоздании контейнера всё записанное исчезает. Плюс copy-up больших файлов и общая медленность записи через overlay. Поэтому PostgreSQL, MinIO и любые данные хранят в volume, который монтируется мимо overlayfs и переживает пересоздание контейнера.</p>
</details>
<details><summary>«Kubernetes удалил поддержку Docker. Что это значит для вас?»</summary>
<p>В 1.24 из kubelet удалили dockershim — прослойку, через которую kubelet использовал Docker Engine как container runtime. Узлы теперь работают с containerd или CRI-O через CRI. Для разработчика ничего не меняется: Docker собирает стандартные OCI-образы, и их запускает любой OCI-совместимый runtime. Меняется только эксплуатация узлов: нельзя полагаться на docker.sock на узле (например, для сборки образов внутри пода — для этого есть Kaniko, BuildKit, Buildah), а для отладки на узле используют <code>crictl</code> вместо <code>docker</code>.</p>
</details>
<details><summary>«Почему контейнер останавливается ровно 10 секунд и выходит с кодом 137?»</summary>
<p>Это значит, что SIGTERM не привёл к завершению, и Docker после таймаута отправил SIGKILL (128 + 9 = 137). Типичная причина — главный процесс не обрабатывает SIGTERM. Чаще всего это shell form ENTRYPOINT: PID 1 — это <code>/bin/sh</code>, который не пересылает сигнал приложению. Вторая причина — сам процесс PID 1 без обработчика: ядро для PID 1 не применяет действие сигнала по умолчанию. Третья — приложение получает сигнал, но не успевает завершиться: висящие фоновые задачи, долгий StopAsync. Исправление: exec form <code>ENTRYPOINT ["dotnet", "App.dll"]</code>, <code>exec</code> в конце скрипта-обёртки или tini, и проверка, что хост укладывается в таймаут.</p>
</details>
<details><summary>«Зачем нужен tini или --init?»</summary>
<p>PID 1 в контейнере выполняет роль init: получает сигналы и обязан собирать завершившихся осиротевших потомков. Приложение, которое не написано как init, не делает wait() для чужих детей, и при запуске внешних процессов копятся зомби, а иногда и сигналы не доходят до нужного процесса. Tini или dumb-init становится PID 1, пересылает сигналы дочернему процессу и собирает зомби. Для обычного ASP.NET Core API без дочерних процессов это не обязательно: .NET-хост обрабатывает SIGTERM сам. Нужен, если сервис запускает внешние утилиты или если точка входа — скрипт.</p>
</details>
`
    },
    {
      id: 'dockerfile',
      title: 'Dockerfile для .NET',
      html: `
<h3>Multi-stage: SDK для сборки, runtime для запуска</h3>
<p>Для сборки .NET-приложения нужен SDK: компилятор Roslyn, MSBuild, NuGet, шаблоны, — это образ порядка гигабайта. Для запуска нужен только рантайм и ASP.NET Core shared framework. Тащить SDK в продакшен плохо по трём причинам: размер (медленный pull на каждом узле, больше места в registry), поверхность атаки (компиляторы, исходники, кэш NuGet внутри работающего контейнера) и число уязвимостей, которые найдёт сканер.</p>
<p><strong>Multi-stage build</strong> решает это: в одном Dockerfile несколько <code>FROM</code>, каждый начинает новую стадию, а в итоговый образ попадает только последняя (или указанная через <code>--target</code>). Из предыдущих стадий забирают нужные файлы через <code>COPY --from</code>.</p>
<pre><code># syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# 1. Только файлы, от которых зависит restore
COPY Directory.Build.props Directory.Packages.props ./
COPY src/Api/Api.csproj src/Api/
COPY src/Domain/Domain.csproj src/Domain/
COPY src/Infra/Infra.csproj src/Infra/
RUN dotnet restore src/Api/Api.csproj

# 2. Всё остальное
COPY src/ src/
RUN dotnet publish src/Api/Api.csproj -c Release -o /app/publish --no-restore -p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS final
WORKDIR /app
COPY --from=build /app/publish .
USER $APP_UID
ENTRYPOINT ["dotnet", "Api.dll"]</code></pre>
<p>Разберём неочевидное:</p>
<ul>
<li><code>-p:UseAppHost=false</code> — не создавать нативный исполняемый файл-обёртку <code>Api</code>: мы запускаем через <code>dotnet Api.dll</code>, и он не нужен.</li>
<li><code>--no-restore</code> — restore уже сделан отдельным слоем, второй раз он не должен трогать сеть.</li>
<li>Мажорная версия рантайма должна совпадать с <code>TargetFramework</code>, а SDK должен быть не старше его. Образ <code>sdk:10.0</code> умеет собирать и <code>net9.0</code>, но запускать сборку для <code>net10.0</code> на <code>aspnet:9.0</code> нельзя.</li>
<li>Стадии, от которых не зависит итоговая, BuildKit не выполняет вообще. Это позволяет держать в одном файле стадию для тестов или для мигратора и собирать её только по <code>--target</code>.</li>
</ul>

<h3>Какие базовые образы бывают</h3>
<p>Microsoft публикует образы в <code>mcr.microsoft.com/dotnet/</code>:</p>
<table>
<thead><tr><th>Образ</th><th>Что внутри</th><th>Когда</th></tr></thead>
<tbody>
<tr><td><code>sdk</code></td><td>SDK, рантайм, инструменты</td><td>Только стадия сборки и тестов</td></tr>
<tr><td><code>aspnet</code></td><td>.NET runtime + ASP.NET Core</td><td>Веб-API, gRPC, Blazor Server</td></tr>
<tr><td><code>runtime</code></td><td>Только .NET runtime</td><td>Консольные приложения, воркеры без ASP.NET</td></tr>
<tr><td><code>runtime-deps</code></td><td>Только нативные зависимости ОС (libc, OpenSSL, ICU…), без .NET</td><td>Self-contained и Native AOT приложения</td></tr>
</tbody>
</table>
<p>Каждый существует в нескольких вариантах ОС, которые выбираются суффиксом тега:</p>
<ul>
<li><strong>Debian / Ubuntu</strong> (например, <code>9.0</code>, <code>9.0-noble</code>) — полноценный дистрибутив с shell и пакетным менеджером. Удобно отлаживать, больше всего пакетов и уязвимостей в отчёте сканера.</li>
<li><strong>Alpine</strong> (<code>9.0-alpine</code>) — маленький образ на musl libc вместо glibc. Нативные библиотеки в NuGet-пакетах должны иметь сборку под <code>linux-musl-x64</code>, иначе получите ошибку загрузки библиотеки в рантайме. В Alpine-образах .NET по умолчанию включён режим инвариантной глобализации — ICU не установлен.</li>
<li><strong>Chiseled</strong> (<code>9.0-noble-chiseled</code>, в .NET 8 — <code>8.0-jammy-chiseled</code>) — «distroless»-образы Ubuntu, из которых вырезано всё, кроме необходимого для рантайма: нет shell, нет пакетного менеджера, нет <code>curl</code>. Запускаются под непривилегированным пользователем по умолчанию. Вариант <code>-chiseled-extra</code> дополнительно содержит ICU и tzdata для приложений, которым нужны культуры и часовые пояса. Есть и <code>-chiseled-composite</code> с предварительно скомпилированным фреймворком для быстрого старта.</li>
</ul>
<p>Выбор на практике. Chiseled — хороший продакшен-дефолт: маленький, мало CVE, non-root. Цена — нельзя сделать <code>kubectl exec -- sh</code>, отлаживать приходится через ephemeral containers. Alpine оправдан, если все зависимости дружат с musl. Для Native AOT — <code>runtime-deps</code> в chiseled-варианте, итоговый образ получается в десятки мегабайт.</p>
<p>Отдельно о часовых поясах и культурах: русскоязычному приложению, которое форматирует даты через <code>ru-RU</code> или вызывает <code>TimeZoneInfo.FindSystemTimeZoneById("Europe/Moscow")</code>, нужны ICU и tzdata. В «голом» chiseled и в Alpine их нет — выбирайте <code>-extra</code> или ставьте пакеты, иначе получите исключение в рантайме, а не при сборке.</p>

<h3>Кэширование слоёв: restore до copy</h3>
<p>Docker кэширует результат каждой инструкции. Для <code>RUN</code> ключ кэша — сама строка команды и предыдущий слой; для <code>COPY</code> — ещё и контрольные суммы копируемых файлов. Как только одна инструкция промахивается мимо кэша, <strong>все следующие</strong> выполняются заново.</p>
<p>Наивный Dockerfile:</p>
<pre><code>COPY . .
RUN dotnet restore
RUN dotnet publish -c Release -o /app</code></pre>
<p>Любая правка любого <code>.cs</code>-файла меняет контрольную сумму <code>COPY . .</code>, и restore — скачивание всех NuGet-пакетов — повторяется на каждой сборке. На CI это минуты.</p>
<p>Правильный порядок: сначала копировать только то, от чего зависит restore — <code>*.csproj</code>, <code>Directory.Build.props</code>, <code>Directory.Packages.props</code> (central package management), <code>NuGet.config</code>, <code>global.json</code>, — выполнить <code>dotnet restore</code>, и только потом копировать исходники. Тогда restore повторяется лишь при изменении зависимостей. Это главный приём оптимизации Dockerfile для .NET, и о нём спрашивают почти всегда.</p>
<p>Неудобство: в решении с двадцатью проектами перечислять каждый <code>.csproj</code> вручную утомительно, и новый проект легко забыть. Варианты — скрипт, генерирующий эти строки; или копирование всего дерева с последующим удалением не-csproj файлов в промежуточной стадии; или BuildKit cache mount для каталога пакетов, при котором даже «неправильный» порядок restore почти бесплатен.</p>
<p>Общее правило упорядочивания: инструкции, которые меняются редко (базовый образ, установка системных пакетов, restore), — наверху; часто меняющиеся (исходники, версия сборки в <code>ARG</code>) — внизу. <code>ARG</code> с номером сборки, объявленный в начале и использованный в <code>RUN</code>, инвалидирует весь кэш после себя.</p>

<h3>BuildKit: cache mounts и секреты</h3>
<p>BuildKit — движок сборки по умолчанию в современном Docker. Он умеет параллельно выполнять независимые стадии, пропускать ненужные и монтировать в <code>RUN</code> временные данные, которые <strong>не попадают в слой</strong>.</p>
<p><strong>Cache mount</strong> — постоянный между сборками каталог:</p>
<pre><code>RUN --mount=type=cache,id=nuget,target=/root/.nuget/packages \\
    dotnet restore src/Api/Api.csproj</code></pre>
<p>Пакеты, скачанные в прошлый раз, остаются в кэше BuildKit, и restore берёт их оттуда, даже если слой инвалидирован. Кэш живёт на машине сборки; на эфемерных CI-раннерах его экспортируют (<code>--cache-to</code>/<code>--cache-from</code>, например в registry).</p>
<p><strong>Секреты сборки.</strong> Приватный NuGet-фид требует токен. Худшее, что можно сделать, — передать его через <code>ARG</code> или <code>ENV</code>: значения <code>ARG</code>, использованные в <code>RUN</code>, видны в <code>docker history</code>, <code>ENV</code> остаётся в конфигурации образа навсегда, а скопированный и затем удалённый <code>NuGet.config</code> лежит в нижнем слое. Правильно — secret mount:</p>
<pre><code>RUN --mount=type=secret,id=nugetconfig,target=/src/NuGet.config \\
    dotnet restore src/Api/Api.csproj</code></pre>
<p>Сборка: <code>docker build --secret id=nugetconfig,src=./NuGet.ci.config .</code>. Файл существует только на время этого <code>RUN</code> и не сохраняется ни в одном слое. Аналогично <code>--mount=type=ssh</code> пробрасывает SSH-агент для доступа к приватным git-репозиториям.</p>
<p><strong>Мультиархитектурные образы.</strong> Собирать arm64-образ на amd64 через эмуляцию QEMU медленно. Для .NET есть приём: стадию сборки запускать на родной платформе билд-машины, а кросс-компиляцию поручить SDK:</p>
<pre><code>FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:9.0 AS build
ARG TARGETARCH
WORKDIR /src
COPY . .
RUN dotnet publish src/Api/Api.csproj -a $TARGETARCH -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:9.0
COPY --from=build /app /app</code></pre>
<p><code>docker buildx build --platform linux/amd64,linux/arm64</code> соберёт оба варианта и опубликует image index.</p>

<h3>Non-root, порт 8080 и безопасность образа</h3>
<p>По умолчанию процесс в контейнере работает от <code>root</code> (UID 0). Это root в своём user-namespace, но в обычной конфигурации без user-namespace он совпадает с root хоста; при уязвимости runtime или ошибочно смонтированном каталоге хоста это прямой путь к компрометации узла.</p>
<p>Начиная с .NET 8 официальные образы помогают это исправить:</p>
<ul>
<li>в образах есть пользователь <code>app</code> и переменная окружения <code>APP_UID</code> с его числовым UID — достаточно написать <code>USER $APP_UID</code>;</li>
<li>chiseled-образы уже работают под этим пользователем по умолчанию;</li>
<li>ASP.NET Core в образах по умолчанию слушает порт <strong>8080</strong> (переменная <code>ASPNETCORE_HTTP_PORTS=8080</code>), а не 80: непривилегированный процесс не может открыть порт ниже 1024. Это ломало обновление с .NET 7, где был порт 80, — у сервисов внезапно переставали проходить пробы.</li>
</ul>
<p>Почему указывают <strong>числовой</strong> UID, а не имя: Kubernetes с <code>runAsNonRoot: true</code> проверяет, что пользователь не root, и по имени он этого сделать не может — под с <code>USER app</code> будет отклонён с ошибкой конфигурации. Числовой UID проверяем.</p>
<p>Что ещё входит в гигиену образа:</p>
<ul>
<li>Не держать секреты в <code>ENV</code>, <code>ARG</code> и слоях — только в рантайме через переменные окружения оркестратора или смонтированные файлы.</li>
<li>Фиксировать мажорную и минорную версию базового образа (<code>aspnet:9.0</code>), а не <code>latest</code>, и регулярно пересобирать: Microsoft выпускает патчи образов ежемесячно, и старый образ с тем же тегом не обновится сам у вас в registry.</li>
<li>Сканировать образы (Trivy, Grype, сканер registry) в CI и блокировать критические уязвимости.</li>
<li>Не устанавливать «на всякий случай» <code>curl</code>, <code>vim</code>, <code>procps</code> в продакшен-образ: каждый пакет — новые CVE. Для отладки есть ephemeral containers.</li>
<li>Записывать файлы приложению разрешать только туда, куда нужно: <code>readOnlyRootFilesystem</code> и явный том для <code>/tmp</code>.</li>
</ul>

<h3>dotnet publish без Dockerfile</h3>
<p>С .NET 7 SDK умеет собирать OCI-образ сам, без Dockerfile и даже без Docker-демона, если образ сразу отправляется в registry; с SDK 8.0.200 цель <code>PublishContainer</code> доступна любому проекту без дополнительного NuGet-пакета.</p>
<pre><code>dotnet publish src/Api/Api.csproj -c Release \\
  --os linux --arch x64 \\
  /t:PublishContainer \\
  -p:ContainerRepository=polestar-api \\
  -p:ContainerImageTag=1.4.2</code></pre>
<p>Основные MSBuild-свойства, которые можно положить прямо в <code>.csproj</code>:</p>
<ul>
<li><code>ContainerRepository</code> — имя образа;</li>
<li><code>ContainerImageTag</code> или <code>ContainerImageTags</code> (несколько через точку с запятой);</li>
<li><code>ContainerRegistry</code> — куда отправить; без него образ загружается в локальный Docker;</li>
<li><code>ContainerBaseImage</code> — явный базовый образ, или <code>ContainerFamily</code> (например, <code>noble-chiseled</code>), чтобы SDK сам подобрал образ нужной версии в этом варианте;</li>
<li><code>ContainerUser</code> — пользователь; порты и переменные задаются не свойствами, а элементами <code>ContainerPort</code> и <code>ContainerEnvironmentVariable</code> в <code>ItemGroup</code>.</li>
</ul>
<p>SDK сам выбирает базовый образ под тип проекта: <code>aspnet</code> для веб-проекта, <code>runtime</code> для консоли, <code>runtime-deps</code> для self-contained и AOT. Плюсы: не нужен Dockerfile, сборка воспроизводима, легко собирать в CI без Docker-in-Docker. Ограничения: нельзя выполнить произвольный <code>RUN</code> — установить системный пакет, скачать файл, запустить скрипт. Если приложению нужен, скажем, ImageMagick из пакетов ОС, вам либо нужен собственный базовый образ, либо обычный Dockerfile.</p>
<p>На собеседовании полезно упомянуть эту возможность, но не утверждать, что она «заменила Dockerfile»: в большинстве компаний Dockerfile остаётся, потому что он прозрачен для DevOps и позволяет произвольные шаги.</p>

<h3>Несколько target-ов: API и мигратор из одних исходников</h3>
<p>Миграции базы удобно поставлять отдельным образом: у него другие права (владелец схемы, а не роль приложения), другой жизненный цикл (выполнился и завершился) и другая точка входа. При этом исходники одни, и собирать их дважды незачем. Решение — несколько итоговых стадий в одном Dockerfile, которые выбираются через <code>--target</code>:</p>
<pre><code>FROM build AS bundle
RUN dotnet tool install --global dotnet-ef
ENV PATH="$PATH:/root/.dotnet/tools"
RUN dotnet ef migrations bundle \\
      --project src/Migrations \\
      --self-contained -r linux-x64 \\
      -o /app/efbundle

FROM mcr.microsoft.com/dotnet/runtime-deps:9.0 AS migrator
COPY --from=bundle /app/efbundle /app/efbundle
USER $APP_UID
ENTRYPOINT ["/app/efbundle"]

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS api
COPY --from=build /app/publish /app
WORKDIR /app
USER $APP_UID
ENTRYPOINT ["dotnet", "Api.dll"]</code></pre>
<p><code>docker build --target api -t api:1.4.2 .</code> и <code>docker build --target migrator -t migrator:1.4.2 .</code> используют общий кэш стадии <code>build</code>. EF Core migration bundle — это исполняемый файл, который применяет миграции; строку подключения ему передают аргументом <code>--connection</code> или через конфигурацию так же, как приложению. Self-contained bundle не требует .NET в образе, поэтому подходит <code>runtime-deps</code>. Обратите внимание: без <code>--target</code> собирается последняя стадия файла, поэтому основную (здесь <code>api</code>) ставят в конец — тогда привычный <code>docker build .</code> по-прежнему даёт образ API.</p>

<h3>.dockerignore, HEALTHCHECK и размер</h3>
<p><strong>.dockerignore</strong> определяет, что не отправляется в build context. Без него <code>COPY . .</code> тащит в образ <code>.git</code>, <code>bin/</code> и <code>obj/</code> с хоста, <code>.vs</code>, <code>.idea</code>, <code>node_modules</code> и — хуже всего — файлы с секретами вроде <code>.env</code>. Минимальный файл:</p>
<pre><code>**/bin/
**/obj/
**/.vs/
**/.idea/
**/*.user
**/node_modules/
.git/
**/.env
**/appsettings.*.local.json</code></pre>
<p>Каталоги <code>obj/</code> с хоста опасны и функционально: в них лежит <code>project.assets.json</code> с путями к пакетам на машине разработчика (часто Windows-путями). Скопированный поверх результата restore в контейнере, он ломает сборку странными ошибками о ненайденных пакетах. Большой context ещё и замедляет каждую сборку: он передаётся демону целиком.</p>
<p><strong>HEALTHCHECK</strong> в Dockerfile задаёт команду, которой Docker проверяет здоровье контейнера. Её используют Docker и Compose (<code>depends_on: condition: service_healthy</code>), но <strong>Kubernetes её игнорирует</strong> — там здоровье проверяет kubelet пробами из манифеста. Проблема в chiseled-образах: там нет <code>curl</code> и <code>wget</code>, а <code>HEALTHCHECK CMD curl ...</code> молча не сработает — контейнер навсегда останется unhealthy. Варианты: проверка в Compose-файле с образом, где есть инструменты; маленькая утилита проверки, собранная вместе с приложением; режим запуска самого приложения, который делает HTTP-запрос к себе и выходит с кодом 0 или 1.</p>
<p><strong>Как уменьшить образ</strong>, по убыванию эффекта: не тащить SDK в итоговую стадию (multi-stage); выбрать chiseled или Alpine; не устанавливать лишних пакетов, а если устанавливать — в одном <code>RUN</code> с очисткой кэша пакетного менеджера; .dockerignore; для небольших сервисов — trimming и Native AOT на <code>runtime-deps</code>. Посмотреть, какой слой сколько весит, можно через <code>docker history</code> или утилиту <code>dive</code>.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Зачем multi-stage build и как он выглядит для .NET?»</summary>
<p>Сборке нужен SDK, а запуску — только рантайм, и SDK в продакшен-образе — это лишние сотни мегабайт, исходники, компилятор и множество уязвимостей в отчёте сканера. Multi-stage позволяет в одном Dockerfile собрать приложение в стадии на образе <code>sdk</code>, а в итоговую стадию на <code>aspnet</code> скопировать только результат <code>dotnet publish</code> через <code>COPY --from=build</code>. Итоговый образ содержит лишь последнюю стадию. Дополнительно можно держать в файле стадии для тестов или мигратора и выбирать их через <code>--target</code>; BuildKit выполняет только те стадии, от которых зависит выбранная.</p>
</details>
<details><summary>«Почему csproj копируют отдельно до исходников?»</summary>
<p>Docker кэширует слои, и при промахе кэша на одной инструкции все последующие выполняются заново. Ключ кэша <code>COPY</code> — контрольные суммы файлов, поэтому <code>COPY . .</code> перед restore инвалидирует restore при любой правке кода. Если сначала скопировать только <code>.csproj</code>, <code>Directory.Packages.props</code>, <code>NuGet.config</code>, выполнить restore, а потом копировать исходники, restore повторяется только при изменении зависимостей. На CI это экономит минуты на каждой сборке. Дополнительно помогает BuildKit cache mount для каталога NuGet-пакетов.</p>
</details>
<details><summary>«Чем отличаются образы aspnet, runtime, runtime-deps? Что такое chiseled?»</summary>
<p><code>aspnet</code> содержит рантайм и ASP.NET Core — для веб-приложений; <code>runtime</code> — только рантайм для консольных воркеров; <code>runtime-deps</code> — только нативные зависимости ОС без .NET, для self-contained и Native AOT. Chiseled — это Ubuntu-образы без shell, пакетного менеджера и лишних утилит, работающие под непривилегированным пользователем по умолчанию: меньше размер и CVE. Вариант <code>-extra</code> добавляет ICU и tzdata, без них приложение работает в invariant-режиме глобализации и не находит часовые пояса. Минус chiseled — в контейнер нельзя зайти shell-ом, отладка через ephemeral containers.</p>
</details>
<details><summary>«Как передать токен приватного NuGet-фида в сборку?»</summary>
<p>Через BuildKit secret mount: <code>RUN --mount=type=secret,id=nugetconfig,target=/src/NuGet.config dotnet restore</code> и <code>docker build --secret id=nugetconfig,src=...</code>. Файл доступен только на время одной инструкции и не попадает ни в один слой. Нельзя передавать токен через <code>ARG</code> — его значение видно в <code>docker history</code>; через <code>ENV</code> — он остаётся в конфигурации образа; копировать файл и удалять следующим шагом бессмысленно — он остаётся в нижнем слое. В multi-stage сборке секрет в стадии <code>build</code> хотя бы не попадает в итоговый образ, но промежуточные слои могут остаться в кэше CI и в registry кэша.</p>
</details>
<details><summary>«Почему в .NET 8 приложение в контейнере слушает 8080, а не 80?»</summary>
<p>Образы .NET 8 перешли на запуск под непривилегированным пользователем, а такой процесс не может открыть порт ниже 1024. Поэтому <code>ASPNETCORE_HTTP_PORTS</code> по умолчанию равен 8080, в образах появился пользователь <code>app</code> и переменная <code>APP_UID</code>. При миграции с .NET 7 это частая причина поломок: Service и пробы смотрят на 80, а приложение слушает 8080. В Dockerfile пишут <code>USER $APP_UID</code> с числовым UID — так Kubernetes может проверить <code>runAsNonRoot</code>.</p>
</details>
<details><summary>«Что не так с HEALTHCHECK CMD curl в chiseled-образе?»</summary>
<p>В chiseled нет ни <code>curl</code>, ни <code>wget</code>, ни shell, поэтому проверка не может выполниться, и контейнер считается unhealthy. Если Compose ждёт <code>service_healthy</code>, зависимые сервисы никогда не стартуют. Варианты решения: проверка, реализованная самим приложением (режим запуска с флагом, который опрашивает собственный endpoint), отдельный крошечный бинарь в образе или проверка на уровне оркестратора. В Kubernetes Docker HEALTHCHECK вообще не используется — там работают liveness/readiness/startup probes, которые выполняет kubelet снаружи по HTTP или TCP.</p>
</details>
<details><summary>«Что такое /t:PublishContainer и когда им не воспользоваться?»</summary>
<p>Это встроенная в .NET SDK сборка OCI-образа прямо из <code>dotnet publish</code>, без Dockerfile, а при отправке в registry — и без Docker-демона. Образ настраивается MSBuild-свойствами: <code>ContainerRepository</code>, <code>ContainerImageTags</code>, <code>ContainerRegistry</code>, <code>ContainerBaseImage</code> или <code>ContainerFamily</code>, <code>ContainerUser</code>. Базовый образ подбирается по типу проекта. Ограничение — нельзя выполнить произвольные команды сборки: установить пакет ОС, скачать файл, выполнить скрипт. Если нужны такие шаги, либо готовят собственный базовый образ, либо используют обычный Dockerfile.</p>
</details>
<details><summary>«Как бы вы уменьшили образ .NET-сервиса?»</summary>
<p>Первое — multi-stage, чтобы SDK не попал в итоговый образ; это даёт больше всего. Второе — базовый образ chiseled или Alpine вместо полного Debian/Ubuntu, с учётом ICU, tzdata и совместимости нативных библиотек с musl. Третье — .dockerignore, чтобы в образ не попали <code>bin</code>, <code>obj</code>, <code>.git</code>. Четвёртое — не устанавливать отладочные пакеты, а если что-то ставится через <code>apt</code> — в одном <code>RUN</code> с очисткой кэша, потому что удаление в следующем слое не уменьшает образ. Для небольших сервисов — trimming или Native AOT на <code>runtime-deps</code>, если библиотеки это поддерживают (EF Core, рефлексия и динамическая генерация кода ограничивают AOT). Анализировать слои — <code>docker history</code> и <code>dive</code>.</p>
</details>
`
    },
    {
      id: 'compose',
      title: 'Docker Compose и локальная разработка',
      html: `
<h3>Модель Compose: проект, сервисы, ресурсы</h3>
<p>Docker Compose описывает набор связанных контейнеров одним YAML-файлом (<code>compose.yaml</code> или исторически <code>docker-compose.yml</code>). Основные понятия:</p>
<ul>
<li><strong>Проект</strong> — всё, что описано в файле и запущено вместе. Имя проекта по умолчанию — имя каталога; задаётся ключом <code>name:</code>, флагом <code>-p</code> или переменной <code>COMPOSE_PROJECT_NAME</code>. Имя попадает во все ресурсы: контейнер <code>polestar-postgres-1</code>, сеть <code>polestar_default</code>, том <code>polestar_pgdata</code>. Поэтому два проекта из одного файла с разными именами (dev и e2e) не мешают друг другу.</li>
<li><strong>Сервис</strong> — описание контейнера (или нескольких реплик): образ или контекст сборки, переменные, порты, тома, зависимости.</li>
<li><strong>Сети</strong> и <strong>тома</strong> — ресурсы верхнего уровня, которые Compose создаёт для проекта.</li>
</ul>
<p>Команды, которые надо знать:</p>
<ul>
<li><code>docker compose up -d</code> — создать и запустить всё в фоне; повторный вызов пересоздаёт только те сервисы, у которых изменилась конфигурация или образ;</li>
<li><code>docker compose up -d --build api</code> — пересобрать и перезапустить один сервис;</li>
<li><code>docker compose down</code> — остановить и удалить контейнеры и сети; <code>down -v</code> удаляет ещё и именованные тома, то есть <strong>данные</strong>;</li>
<li><code>docker compose logs -f api</code>, <code>ps</code>, <code>exec postgres psql -U app</code>;</li>
<li><code>docker compose run --rm migrator</code> — разовый запуск сервиса;</li>
<li><code>docker compose config</code> — показать итоговую конфигурацию после подстановки переменных и слияния файлов. Первое, что стоит выполнить, если «переменная не подставилась».</li>
</ul>
<p>Compose — декларативный в описании, но <strong>императивный в исполнении</strong>: он приводит состояние к описанному только в момент, когда вы выполняете команду. Никакого постоянного цикла согласования, как у Kubernetes, нет.</p>

<h3>Сети: DNS по имени сервиса</h3>
<p>Compose создаёт для проекта bridge-сеть <code>default</code> и подключает к ней все сервисы. Внутри сети работает встроенный DNS Docker: сервис доступен по своему <strong>имени</strong>. API обращается к базе как <code>Host=postgres;Port=5432</code>, а не по IP, — IP контейнера меняется при каждом пересоздании.</p>
<p>Две частые ошибки:</p>
<ul>
<li><strong><code>localhost</code> внутри контейнера — это сам контейнер</strong>, а не хост и не соседний сервис. Строка подключения <code>Host=localhost</code>, работавшая у API, запущенного из IDE, ломается, когда API переезжает в контейнер. Внутри сети нужен <code>postgres</code>; к хосту — <code>host.docker.internal</code> (в Docker Desktop есть сразу, в Linux добавляется через <code>extra_hosts: ["host.docker.internal:host-gateway"]</code>).</li>
<li><strong>Порт внутри и порт снаружи — разные вещи.</strong> Сервисы одной сети ходят друг к другу по <em>внутреннему</em> порту контейнера (5432), публиковать порты для этого не нужно. <code>ports</code> нужен только для доступа с хоста.</li>
</ul>
<p><code>ports: ["5432:5432"]</code> публикует порт на <strong>всех интерфейсах</strong> хоста, то есть база доступна из локальной сети. На Linux Docker пишет собственные правила iptables, и такие порты открыты в обход <code>ufw</code>, что регулярно приводит к утечкам баз на серверах. Для разработки публикуйте на loopback: <code>"127.0.0.1:5432:5432"</code>. Ключ <code>expose</code> только документирует порт и наружу ничего не открывает.</p>
<p>Сетей может быть несколько: например, <code>frontend</code> для nginx и API и <code>backend</code> для API и базы. Сервис видит только сервисы своих сетей, так база становится недоступна из nginx. У сервиса в сети могут быть дополнительные имена (<code>aliases</code>) — так один контейнер nginx может отвечать на несколько DNS-имён внутри сети.</p>

<h3>Volumes: named, bind, tmpfs</h3>
<p>Записываемый слой контейнера исчезает вместе с ним, поэтому всё долговечное монтируется томами:</p>
<ul>
<li><strong>Named volume</strong> (<code>pgdata:/var/lib/postgresql/data</code> плюс объявление в <code>volumes:</code> верхнего уровня) — каталог, которым управляет Docker. Переживает <code>down</code> и пересоздание контейнера, удаляется только <code>down -v</code> или <code>docker volume rm</code>. Правильный выбор для данных PostgreSQL, MinIO, Keycloak.</li>
<li><strong>Bind mount</strong> (<code>./infra/nginx/nginx.conf:/etc/nginx/nginx.conf:ro</code>) — конкретный путь хоста. Для конфигурационных файлов, сертификатов, исходников при hot reload. На Windows и macOS bind mount в Linux-ВМ заметно медленнее named volume; для базы его лучше не использовать. Ещё одна грабля — права: файлы хоста имеют UID пользователя хоста, а процесс в контейнере работает под своим UID.</li>
<li><strong>tmpfs</strong> — каталог в памяти, для временных файлов и как записываемый <code>/tmp</code> при read-only корне.</li>
</ul>
<p>Суффикс <code>:ro</code> монтирует только для чтения — для конфигурации это хорошая привычка: контейнер не испортит файл на хосте.</p>
<p>Нюанс образов баз данных: скрипты инициализации из <code>/docker-entrypoint-initdb.d</code> у PostgreSQL выполняются <strong>только при пустом каталоге данных</strong>. Поменяли скрипт создания ролей — ничего не произойдёт, пока не удалите том. То же с переменными <code>POSTGRES_PASSWORD</code>: на существующих данных пароль из переменной не применяется. Похожим образом realm import Keycloak срабатывает только для realm, которого ещё нет.</p>

<h3>depends_on и healthcheck</h3>
<p>Короткая форма</p>
<pre><code>depends_on:
  - postgres</code></pre>
<p>гарантирует только <strong>порядок запуска</strong>: контейнер postgres стартует раньше api. Но «процесс запущен» не значит «база принимает соединения»: PostgreSQL ещё секунду-другую инициализируется, и API, стартовавший в этот момент, падает с ошибкой подключения. Длинная форма позволяет ждать условия:</p>
<pre><code>services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?set it in .env}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 10

  migrator:
    image: polestar-migrator:dev
    depends_on:
      postgres:
        condition: service_healthy

  api:
    image: polestar-api:dev
    depends_on:
      migrator:
        condition: service_completed_successfully

volumes:
  pgdata:</code></pre>
<p>Три условия: <code>service_started</code> (поведение короткой формы), <code>service_healthy</code> (ждать, пока healthcheck зависимости станет зелёным) и <code>service_completed_successfully</code> (дождаться, пока одноразовый контейнер завершится с кодом 0). Последнее идеально для миграций: API не стартует на непромигрированной базе, а упавшая миграция остановит запуск.</p>
<p>Важное ограничение: <code>depends_on</code> работает только при запуске через Compose. Если база перезапустилась позже, API об этом не узнает; поэтому приложение всё равно должно уметь переподключаться (retry в Npgsql/EF Core, Polly), а не полагаться на порядок старта. В Kubernetes <code>depends_on</code> нет вовсе — там такую же устойчивость обеспечивают пробы и повторы.</p>
<p>Ещё одна тонкость: <code>docker compose up --wait</code> ждёт, пока сервисы окажутся в состоянии running или healthy. Одноразовый сервис, который ещё работает, уже «running», поэтому <code>--wait</code> может вернуться до окончания миграций или скрипта настройки. Если скрипту дальше нужен результат — ждите конкретный контейнер (<code>docker wait</code>) и проверяйте код выхода.</p>

<h3>Переменные окружения: environment, env_file, .env</h3>
<p>Здесь путаются даже опытные разработчики, потому что механизмов два, и они про разное.</p>
<p><strong>Интерполяция</strong> — подстановка <code>\${VAR}</code> в сам YAML-файл <em>до</em> создания контейнеров. Значения берутся из переменных окружения shell, а затем из файла <code>.env</code> в каталоге проекта (или указанного через <code>--env-file</code>). Синтаксис:</p>
<ul>
<li><code>\${VAR}</code> — значение или пустая строка;</li>
<li><code>\${VAR:-default}</code> — значение по умолчанию, если переменная не задана или пуста;</li>
<li><code>\${VAR:?message}</code> — ошибка запуска, если переменной нет. Хорошо для обязательных паролей;</li>
<li><code>$$</code> — буквальный знак доллара в значении.</li>
</ul>
<p><strong>Переменные контейнера</strong> — то, что процесс внутри увидит в своём окружении. Их задают ключом <code>environment</code> (прямо в файле) или <code>env_file</code> (файл со строками <code>KEY=value</code>). Порядок приоритета: <code>docker compose run -e</code> выше <code>environment</code>, тот выше <code>env_file</code>, тот выше <code>ENV</code> из образа.</p>
<p>Классическая ошибка: положить <code>ConnectionStrings__Db=...</code> в <code>.env</code> и ждать, что API её увидит. Файл <code>.env</code> используется для интерполяции и <strong>сам по себе в контейнер не попадает</strong>. Его нужно либо явно указать в <code>env_file: .env</code>, либо прокинуть: <code>ConnectionStrings__Db: \${DB_CONNECTION}</code>.</p>
<p>Для ASP.NET Core двойное подчёркивание в имени переменной — разделитель секций: <code>ConnectionStrings__Default</code> становится <code>ConnectionStrings:Default</code>, <code>Keycloak__Authority</code> — <code>Keycloak:Authority</code>. Переменные окружения по умолчанию перекрывают <code>appsettings.json</code>.</p>
<p>Секреты в <code>.env</code> — нормальная практика для разработки и одного сервера, если файл в <code>.gitignore</code> и не попадает в build context. Compose поддерживает и ключ <code>secrets:</code>, который монтирует файл в <code>/run/secrets/имя</code>, — это лучше, чем переменная, потому что переменные окружения видны в <code>docker inspect</code> и наследуются дочерними процессами.</p>

<h3>Profiles и несколько файлов</h3>
<p>Не всё нужно запускать всегда. <strong>Profiles</strong> помечают необязательные сервисы:</p>
<pre><code>services:
  pgadmin:
    image: dpage/pgadmin4
    profiles: ["tools"]
  seed:
    build: ./infra/seed
    profiles: ["seed"]</code></pre>
<p>Сервисы без <code>profiles</code> запускаются всегда, а с профилем — только при <code>docker compose --profile tools up</code> или <code>COMPOSE_PROFILES=tools</code>. Сервис, на который явно сослались в команде (<code>docker compose run seed</code>), запускается независимо от профиля.</p>
<p><strong>Несколько файлов</strong> сливаются: <code>docker compose -f compose.yaml -f compose.e2e.yaml up</code>. Скалярные значения перекрываются последним файлом, списки портов и переменных объединяются. Файл <code>compose.override.yaml</code> рядом с основным подхватывается автоматически — туда кладут локальные настройки разработчика. Есть также <code>include:</code> для подключения других Compose-файлов и <code>extends</code> для наследования описания сервиса.</p>
<p>Типичная схема для проекта: основной файл со всей инфраструктурой для разработки; отдельный файл или отдельный проект для end-to-end тестов на сдвинутых портах и своих томах, чтобы тесты не засоряли рабочую базу; отдельный файл для сервера, где API тоже в контейнере, а наружу смотрит только nginx. Для интеграционных тестов внутри .NET альтернатива Compose — <strong>Testcontainers</strong>: тест сам поднимает PostgreSQL в контейнере на случайном порту и удаляет его после прогона.</p>

<h3>Почему Compose — не продакшен-оркестратор</h3>
<p>Compose отлично подходит для разработки, CI и небольших установок на одном сервере. Но у него нет того, ради чего существуют оркестраторы:</p>
<ul>
<li><strong>Один хост.</strong> Compose управляет контейнерами одного Docker-демона. Умер сервер — умерло всё, и никто не перенесёт сервисы на другую машину.</li>
<li><strong>Нет непрерывного согласования.</strong> Политика <code>restart: unless-stopped</code> перезапустит упавший контейнер (это делает демон), но не пересоздаст удалённый, не исправит дрейф конфигурации, не заменит контейнер, который «завис», но не упал: Docker HEALTHCHECK только помечает контейнер unhealthy и сам его не перезапускает.</li>
<li><strong>Нет управляемых обновлений.</strong> <code>up -d</code> останавливает старый контейнер и запускает новый — между ними простой. Нет rolling update с проверкой готовности, нет автоматического отката, нет распределения трафика между версиями.</li>
<li><strong>Нет масштабирования</strong> по нагрузке, нет распределения реплик по узлам и зонам, нет встроенного балансировщика с исключением неготовых реплик.</li>
<li><strong>Скромное управление секретами и доступом</strong>: нет RBAC, нет интеграции с хранилищами секретов, нет политик безопасности подов.</li>
</ul>
<p>При этом «Compose на одном сервере» — честный выбор для стартапа или стейджинга: проще, дешевле, понятнее, и для многих продуктов на ранней стадии его достаточно. На собеседовании хорошо звучит так: «у себя я держу стек в Compose на одном сервере с nginx перед API, миграции — отдельным одноразовым контейнером, который API ждёт через <code>service_completed_successfully</code>; я понимаю, что это не даёт отказоустойчивости и обновлений без простоя, и знаю, что для этого даёт Kubernetes». Промежуточный вариант между ними — Docker Swarm, но в новых проектах его выбирают редко.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Сервисы в Compose — как они находят друг друга?»</summary>
<p>Compose создаёт для проекта сеть и подключает к ней все сервисы, а встроенный DNS Docker разрешает имя сервиса в IP его контейнера (или контейнеров). Поэтому API обращается к базе как <code>Host=postgres</code>, по внутреннему порту контейнера, без публикации портов. <code>localhost</code> внутри контейнера — это сам контейнер, поэтому строка подключения из IDE в контейнере не работает. К хосту обращаются через <code>host.docker.internal</code>. Можно разделить сервисы по нескольким сетям, тогда они видят только соседей по своим сетям.</p>
</details>
<details><summary>«depends_on гарантирует, что база готова?»</summary>
<p>Короткая форма — нет, только порядок запуска контейнеров. Чтобы дождаться готовности, нужен healthcheck у зависимости и <code>condition: service_healthy</code>; для одноразовых задач вроде миграций — <code>condition: service_completed_successfully</code>. Но и это работает только при старте через Compose: если база перезапустится позже, приложение должно само переподключаться. Поэтому retry при подключении к базе нужен в любом случае, и в Kubernetes, где depends_on нет, он обязателен.</p>
</details>
<details><summary>«Положил переменную в .env, а приложение её не видит. Почему?»</summary>
<p>Файл <code>.env</code> в каталоге проекта используется Compose для интерполяции <code>\${VAR}</code> в самом YAML, но в окружение контейнеров автоматически не попадает. Переменную нужно явно передать: <code>environment: { MyVar: \${MyVar} }</code> или подключить файл через <code>env_file</code>. Проверить, что получилось после подстановки, — <code>docker compose config</code>, а что видит процесс — <code>docker compose exec api env</code> (если в образе есть shell) или <code>docker inspect</code>. Для ASP.NET Core ещё стоит проверить имя: секции разделяются двойным подчёркиванием.</p>
</details>
<details><summary>«Named volume или bind mount для PostgreSQL?»</summary>
<p>Named volume. Он управляется Docker, переживает пересоздание контейнера и <code>down</code>, не зависит от структуры каталогов хоста и на Windows и macOS работает значительно быстрее, чем bind mount через границу ВМ. Bind mount уместен для конфигурационных файлов (лучше с <code>:ro</code>), сертификатов и исходников при разработке. Нужно помнить, что <code>down -v</code> удаляет именованные тома вместе с данными, и что init-скрипты образа PostgreSQL выполняются только на пустом каталоге данных.</p>
</details>
<details><summary>«Чем опасен ports: "5432:5432" на сервере?»</summary>
<p>Порт публикуется на всех интерфейсах, и база становится доступна из сети. На Linux Docker добавляет собственные правила iptables, и опубликованные порты обходят <code>ufw</code>, так что «у меня же закрыт фаервол» не защищает. Для разработки нужно публиковать на <code>127.0.0.1</code>, а на сервере не публиковать базу вовсе — сервисы ходят к ней по внутренней сети Compose. Наружу должен смотреть только reverse proxy с TLS.</p>
</details>
<details><summary>«Почему не использовать Compose в продакшене?»</summary>
<p>Compose управляет одним хостом и не даёт отказоустойчивости: упал сервер — упало всё. Он не согласует состояние непрерывно: restart policy перезапускает упавшие контейнеры, но unhealthy-контейнер не заменяется, и дрейф конфигурации никто не исправляет. Обновление через <code>up -d</code> — это остановка и запуск с простоем, без rolling update, проверки готовности и отката. Нет автомасштабирования, распределения по узлам, RBAC, интеграции с хранилищами секретов. Для небольшого продукта на одном сервере Compose — нормальный и дешёвый компромисс, но когда нужны доступность и обновления без простоя, это задача оркестратора.</p>
</details>
<details><summary>«Зачем profiles и как организовать dev и e2e окружения?»</summary>
<p>Profiles помечают необязательные сервисы — админку базы, сидер данных, инструменты, — которые не запускаются по умолчанию, а только с <code>--profile</code>. Для разных окружений используют слияние нескольких файлов (<code>-f base.yaml -f e2e.yaml</code>) и разные имена проектов, чтобы у каждого окружения были свои контейнеры, сети и тома. E2E-окружению стоит сдвинуть опубликованные порты, чтобы оно жило рядом с dev-окружением, и держать отдельные тома, которые можно быстро сбросить. Переменные, общие для файлов, выносят в <code>.env</code>.</p>
</details>
`
    },
    {
      id: 'dotnet',
      title: '.NET в контейнере',
      html: `
<h3>Что рантайм узнаёт о контейнере</h3>
<p>Начиная с .NET Core 3.0 рантайм умеет читать лимиты cgroup и подстраиваться под них (cgroup v2 поддерживается с .NET 5). Это важно, потому что внутри контейнера <code>/proc/meminfo</code> и <code>/proc/cpuinfo</code> показывают ресурсы <strong>всего узла</strong>: 64 ядра и 256 ГБ, даже если контейнеру разрешено 2 ядра и 1 ГБ. Приложение, которое судит о ресурсах по ним, ошибётся во всём — в числе потоков, размере кэшей и куче.</p>
<p>Что учитывается:</p>
<ul>
<li><strong>Лимит памяти</strong> cgroup становится для GC «физической памятью машины»: от него считаются пороги, при которых GC становится агрессивнее, и жёсткий лимит кучи (следующий раздел). Значение видно в <code>GC.GetGCMemoryInfo().TotalAvailableMemoryBytes</code>.</li>
<li><strong>CPU-квота</strong> (то, во что превращается CPU limit в Kubernetes) ограничивает <code>Environment.ProcessorCount</code>: квота 2 CPU на 64-ядерном узле даёт <code>ProcessorCount == 2</code>; дробная квота округляется вверх (1.5 CPU → 2). Учитывается и CPU affinity (<code>cpuset</code>). <strong>CPU request</strong> (веса cgroup) на <code>ProcessorCount</code> не влияет.</li>
<li>От <code>ProcessorCount</code> зависят число куч Server GC, минимальное число потоков пула и параллелизм <code>Parallel.For</code> по умолчанию.</li>
</ul>
<p>Переопределить число процессоров можно переменной <code>DOTNET_PROCESSOR_COUNT</code> (с .NET 6). Это нужно, когда CPU limit не задан: тогда <code>ProcessorCount</code> равен числу ядер узла, и сервис на 96-ядерной машине поднимает 96 куч Server GC — об этом ниже.</p>
<p>Официальные образы выставляют переменную <code>DOTNET_RUNNING_IN_CONTAINER=true</code> — по ней код может понять, что работает в контейнере (например, не открывать браузер и не писать в файловые логи).</p>

<h3>Куча под лимитом памяти: GCHeapHardLimit</h3>
<p>Если контейнеру задан лимит памяти, GC по умолчанию ограничивает управляемую кучу значением <strong>max(20 МБ, 75% лимита)</strong>. Почему не 100%: в процессе есть память, которую GC не контролирует, — код JIT, метаданные сборок, стеки потоков, нативные аллокации библиотек (SkiaSharp, ImageMagick, драйверы, сжатие), буферы сокетов, memory-mapped файлы. Оставшиеся 25% — запас под это.</p>
<p>Настройки (в <code>runtimeconfig.json</code> — через <code>runtimeconfig.template.json</code> или элемент MSBuild <code>RuntimeHostConfigurationOption</code>, отдельного MSBuild-свойства у них нет, — или переменными окружения):</p>
<ul>
<li><code>System.GC.HeapHardLimit</code> / <code>DOTNET_GCHeapHardLimit</code> — абсолютный лимит в байтах;</li>
<li><code>System.GC.HeapHardLimitPercent</code> / <code>DOTNET_GCHeapHardLimitPercent</code> — процент от лимита памяти.</li>
</ul>
<p>Грабля: значения GC-настроек в <strong>переменных окружения</strong> интерпретируются как шестнадцатеричные. <code>DOTNET_GCHeapHardLimitPercent=50</code> означает 0x50, то есть 80%, а не 50. В <code>runtimeconfig.json</code> значения десятичные. Поэтому настройки GC надёжнее задавать в проекте, а не в манифесте.</p>
<p>Поднимать процент до 90–95 «чтобы использовать всю память» опасно: управляемая куча займёт почти весь лимит, и первая же нативная аллокация вытолкнет контейнер за лимит cgroup. Опускать имеет смысл, если приложение активно использует нативную память.</p>

<h3>OOMKilled и OutOfMemoryException — разные вещи</h3>
<p>Это любимый вопрос, потому что он проверяет, понимаете ли вы, кто именно ограничивает память.</p>
<table>
<thead><tr><th></th><th>OutOfMemoryException</th><th>OOMKilled</th></tr></thead>
<tbody>
<tr><td>Кто</td><td>GC в процессе .NET</td><td>Ядро Linux, OOM killer cgroup</td></tr>
<tr><td>Когда</td><td>Аллокацию нельзя выполнить в пределах heap hard limit даже после полной сборки</td><td>Вся память контейнера превысила <code>memory.max</code></td></tr>
<tr><td>Что видно</td><td>Исключение со стеком в логах; процесс обычно падает с необработанным исключением</td><td>SIGKILL, код 137, ни строчки в логах приложения, в <code>kubectl describe</code> — Reason: OOMKilled</td></tr>
<tr><td>Типичная причина</td><td>Утечка управляемых объектов, загрузка огромного файла в память, неограниченный кэш</td><td>Нативная память, слишком высокий HeapHardLimitPercent, лимит меньше реальных потребностей, несколько процессов в контейнере</td></tr>
</tbody>
</table>
<p>Если приложение убивают по OOMKilled, а размер управляемой кучи в метриках (<code>dotnet_gc_heap_size</code>, <code>dotnet-counters</code>) стабилен и далёк от лимита — ищите нативную память или рост числа потоков. Сравнивайте метрику <code>container_memory_working_set_bytes</code> с размером управляемой кучи: разница и есть «не-GC» память.</p>
<p>Ещё одна тонкость: в память cgroup засчитывается и page cache файлов, которые читает процесс, но ядро вытесняет его раньше, чем убивает процесс. Поэтому «working set растёт из-за чтения файлов» обычно не ведёт к OOM, а «RSS растёт» — ведёт.</p>

<h3>Server GC, Workstation GC и DATAS</h3>
<p><strong>Workstation GC</strong> — одна управляемая куча, сборка выполняется на потоке, который вызвал аллокацию, с фоновым (concurrent) режимом по умолчанию. Меньше памяти, меньше пропускная способность при большой нагрузке.</p>
<p><strong>Server GC</strong> — отдельная куча и отдельный высокоприоритетный поток GC на каждый логический процессор, большие бюджеты поколения 0. Выше пропускная способность, но заметно больше памяти: каждая куча держит свой запас. ASP.NET Core-проекты (<code>Microsoft.NET.Sdk.Web</code>) используют Server GC по умолчанию. Если процессор один, рантайм использует Workstation GC независимо от настройки.</p>
<p>Отсюда классическая проблема контейнеров до .NET 9: сервис без CPU limit на большом узле получает <code>ProcessorCount</code>, равный числу ядер узла, поднимает десятки куч и потребляет в разы больше памяти, чем на тестовом стенде. Лечили настройкой <code>GCHeapCount</code>, <code>DOTNET_PROCESSOR_COUNT</code>, переходом на Workstation GC или включением <code>GCConserveMemory</code>.</p>
<p><strong>DATAS</strong> (Dynamic Adaptation To Application Sizes) — режим Server GC, в котором число куч не фиксировано, а подстраивается под нагрузку: приложение стартует с одной кучей и добавляет их, когда растёт аллокация, и сокращает, когда нагрузка падает. Размер кучи следует за реальным объёмом живых данных. В .NET 8 DATAS включался явно, в <strong>.NET 9 он включён по умолчанию</strong> для Server GC. Результат — Server GC в контейнерах больше не раздувает память на больших узлах, плотность подов на узле растёт.</p>
<p>Цена DATAS — возможна немного меньшая пиковая пропускная способность и больше сборок поколения 0 на старте нагрузки. Для сервиса, где важна максимальная пропускная способность и память не ограничена, его можно выключить: <code>&lt;GarbageCollectionAdaptationMode&gt;0&lt;/GarbageCollectionAdaptationMode&gt;</code> в проекте или <code>DOTNET_GCDynamicAdaptationMode=0</code>. Решать такие вещи стоит по метрикам нагрузочного теста, а не заранее.</p>

<h3>CPU-лимит, ProcessorCount и пул потоков</h3>
<p>Пул потоков .NET держит минимум рабочих потоков, равный <code>ProcessorCount</code>. Пока занятых потоков меньше минимума, новые создаются сразу; сверх минимума пул добавляет потоки постепенно, с задержкой — это защищает от лавинообразного создания потоков, но означает, что блокирующий код быстро выедает пул.</p>
<p>В контейнере с лимитом 1–2 CPU минимум — 1–2 потока. Если где-то есть sync-over-async (<code>.Result</code>, <code>.Wait()</code>, синхронный HTTP-клиент, синхронный доступ к базе), пара десятков одновременных запросов занимает все потоки, остальные ждут в очереди, пока пул медленно добавляет новые, — латентность растёт до секунд при почти нулевой загрузке CPU. Это <strong>thread pool starvation</strong>. Признаки: растёт <code>threadpool-queue-length</code> и <code>threadpool-thread-count</code> в <code>dotnet-counters</code>, CPU низкий, ответы медленные.</p>
<p>Лечение — убрать блокирующий код. Временное облегчение — поднять минимум (<code>ThreadPool.SetMinThreads</code> или свойство <code>System.Threading.ThreadPool.MinThreads</code> в runtimeconfig), но это маскирует проблему.</p>
<p>Второе следствие малого CPU-лимита — <strong>медленный старт</strong>. При запуске JIT компилирует много методов, DI-контейнер строит граф, EF Core строит модель — короткий всплеск CPU. Под жёсткой квотой процесс троттлится, и старт, занимающий на ноутбуке две секунды, в поде занимает двадцать. Если liveness probe к этому времени уже проверяет приложение, под убивается до того, как успел подняться. Решения: startup probe, ReadyToRun-сборка (в том числе composite-образы), больший CPU limit или его отсутствие.</p>

<h3>Graceful shutdown на SIGTERM</h3>
<p>Когда Kubernetes или Docker останавливает контейнер, процесс получает SIGTERM, а через grace period — SIGKILL. Всё, что не успело завершиться за это время, обрывается: запросы клиентов получают разрыв соединения, сообщения обрабатываются повторно, транзакции откатываются.</p>
<p>Последовательность в Generic Host:</p>
<ol>
<li><code>ConsoleLifetime</code> получает SIGTERM и вызывает <code>IHostApplicationLifetime.StopApplication()</code>.</li>
<li>Срабатывает токен <code>ApplicationStopping</code>.</li>
<li>Хост вызывает <code>StopAsync</code> у <code>IHostedService</code> в обратном порядке регистрации. Kestrel перестаёт принимать новые соединения и ждёт завершения текущих запросов; у <code>BackgroundService</code> отменяется <code>stoppingToken</code>.</li>
<li>Всё это ограничено <code>HostOptions.ShutdownTimeout</code> — <strong>30 секунд</strong> по умолчанию начиная с .NET 6 (раньше было 5). По истечении токен отмены в <code>StopAsync</code> срабатывает, и хост завершается, не дожидаясь отстающих.</li>
<li>Срабатывает <code>ApplicationStopped</code>, процесс выходит с кодом 0.</li>
</ol>
<pre><code>builder.Services.Configure&lt;HostOptions&gt;(o =&gt;
    o.ShutdownTimeout = TimeSpan.FromSeconds(20));

var app = builder.Build();
app.Lifetime.ApplicationStopping.Register(() =&gt;
    app.Logger.LogInformation("Stopping, draining requests"));</code></pre>
<p>Правила, которые следуют из этого:</p>
<ul>
<li><code>ShutdownTimeout</code> должен быть <strong>меньше</strong> <code>terminationGracePeriodSeconds</code> пода (по умолчанию тоже 30) за вычетом времени preStop-хука. Иначе SIGKILL придёт раньше, чем хост закончит. Обычно: grace 45–60 секунд, preStop 5–10, ShutdownTimeout 25–30.</li>
<li><code>BackgroundService</code> обязан уважать <code>stoppingToken</code>: передавать его во все асинхронные вызовы, выходить из цикла. Консьюмер Kafka на остановке должен закончить текущее сообщение, закоммитить offset и закрыть consumer (что запускает ребалансировку сразу, а не по таймауту сессии).</li>
<li>В .NET 8 появились <code>IHostedLifecycleService</code> (хуки <code>StartingAsync</code>, <code>StoppingAsync</code> и т. д.) и опции <code>ServicesStartConcurrently</code> / <code>ServicesStopConcurrently</code>, чтобы несколько сервисов останавливались параллельно, а не друг за другом в рамках общего таймаута.</li>
<li>SIGTERM не означает, что трафик уже перестал приходить: в Kubernetes удаление пода из балансировки идёт параллельно с отправкой сигнала. Это отдельная тема (preStop и гонка эндпоинтов) в главе о жизненном цикле пода.</li>
</ul>

<h3>Логи в stdout</h3>
<p>В контейнерном мире приложение не пишет логи в файлы и не знает, куда они уходят. Оно пишет в <strong>stdout/stderr</strong>, container runtime сохраняет поток в файл на узле, а агент сбора (Fluent Bit, Vector, OpenTelemetry Collector, Grafana Alloy) отправляет их в Loki, Elasticsearch или другое хранилище. Принцип взят из «12-factor app»: логи — поток событий, маршрутизация — забота среды.</p>
<p>Практика для .NET:</p>
<ul>
<li><strong>Структурированный формат.</strong> Одна запись — одна строка JSON: <code>builder.Logging.AddJsonConsole()</code> или Serilog с компактным JSON-форматтером. Многострочный текст со стектрейсом агент разобьёт на десяток отдельных «событий».</li>
<li><strong>Не писать файлы внутри контейнера</strong>: они пропадут вместе с контейнером, расходуют ephemeral storage узла и могут привести к вытеснению пода.</li>
<li><strong>Корреляция</strong>: в каждом событии TraceId/SpanId (при включённом OpenTelemetry они попадают в scope логгера), чтобы из лога перейти к трейсу.</li>
<li><strong>Уровень логирования</strong> настраивается переменной окружения <code>Logging__LogLevel__Default</code>, без пересборки образа.</li>
<li>Консольный логгер пишет через внутреннюю очередь в фоновом потоке. При корректной остановке он дописывает очередь, при SIGKILL или OOMKilled последние сообщения теряются. Поэтому «в логах ничего нет перед падением» — нормальный симптом OOMKilled.</li>
</ul>

<h3>Глобализация, ICU и часовые пояса</h3>
<p>.NET на Linux берёт данные о культурах из библиотеки <strong>ICU</strong>. Если ICU в образе нет и не включён инвариантный режим, приложение падает при старте с сообщением о том, что не найден пакет ICU.</p>
<p><strong>Invariant mode</strong> (<code>&lt;InvariantGlobalization&gt;true&lt;/InvariantGlobalization&gt;</code> или <code>DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=true</code>) убирает зависимость от ICU: все культуры ведут себя как инвариантная. Последствия для русскоязычного продукта серьёзные: форматирование дат и чисел не по-русски, сравнение и сортировка строк — по кодам символов, а создание культуры вроде <code>new CultureInfo("ru-RU")</code> с .NET 6 по умолчанию бросает <code>CultureNotFoundException</code>. Alpine-образы .NET и chiseled-образы без суффикса <code>-extra</code> идут с включённым инвариантным режимом; если нужны культуры — <code>-extra</code> или установка ICU.</p>
<p>Инвариантный режим подходит сервисам, которые не показывают текст людям: API, отдающему JSON, где форматирование — забота клиента, а сравнения строк ординальные. Но и такой сервис может неожиданно зависеть от культуры — через локализацию сообщений об ошибках по <code>Accept-Language</code> или через библиотеку, вызывающую <code>ToUpper()</code> без культуры. Проверять надо тестами в том же образе, что и продакшен.</p>
<p><strong>Часовые пояса.</strong> <code>TimeZoneInfo.FindSystemTimeZoneById</code> на Linux читает базу <code>/usr/share/zoneinfo</code> из пакета tzdata. В chiseled без <code>-extra</code> и в минимальных образах её нет — получите <code>TimeZoneNotFoundException</code>. С .NET 6 на всех платформах принимаются и IANA-идентификаторы (<code>Europe/Moscow</code>), и Windows-идентификаторы (<code>Russian Standard Time</code>), но преобразование между ними требует ICU. Альтернатива — NodaTime: его <code>DateTimeZoneProviders.Tzdb</code> использует базу, встроенную в сборку, и не зависит от образа (её нужно обновлять вместе с пакетом).</p>
<p>Общее правило: часы контейнера держат в UTC, в базе хранят моменты времени (<code>timestamptz</code>, <code>Instant</code>), а в локальное время переводят явно по часовому поясу пользователя или компании. Полагаться на часовой пояс ОС контейнера (<code>TZ</code>, <code>TimeZoneInfo.Local</code>) нельзя: он разный на ноутбуке, в CI и в кластере.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Как .NET понимает, сколько ему доступно памяти и CPU в контейнере?»</summary>
<p>Рантайм читает лимиты cgroup (v1 и v2), а не <code>/proc/meminfo</code> и <code>/proc/cpuinfo</code>, которые показывают ресурсы узла. Лимит памяти становится для GC объёмом «физической памяти», и от него по умолчанию ставится жёсткий лимит кучи — 75% (но не меньше 20 МБ). CPU-квота, то есть CPU limit, определяет <code>Environment.ProcessorCount</code> с округлением вверх; CPU request на него не влияет. От <code>ProcessorCount</code> зависят число куч Server GC и минимум пула потоков. Число процессоров можно переопределить через <code>DOTNET_PROCESSOR_COUNT</code>, лимит кучи — через <code>GCHeapHardLimit</code> или <code>GCHeapHardLimitPercent</code>.</p>
</details>
<details><summary>«Под постоянно получает OOMKilled, а OutOfMemoryException в логах нет. Почему и что делать?»</summary>
<p>OOMKilled — это ядро, убившее процесс за превышение лимита памяти cgroup; приложение получает SIGKILL и ничего не успевает записать. OutOfMemoryException бросает GC, когда не может уложиться в лимит кучи. Раз исключения нет, управляемая куча, скорее всего, в своих 75%, а за лимит выталкивает память вне кучи: нативные библиотеки, много потоков, memory-mapped файлы, или лимит кучи поднят слишком высоко. Шаги: <code>kubectl describe pod</code> подтверждает OOMKilled и код 137; сравниваю метрики working set контейнера и размера GC-кучи; если растёт куча — снимаю дамп и ищу утечку; если растёт нативная часть — проверяю нативные зависимости. Решение — исправить утечку, поднять лимит под реальное потребление или уменьшить HeapHardLimitPercent, чтобы оставить больше места нативной памяти.</p>
</details>
<details><summary>«Server или Workstation GC в контейнере? Что такое DATAS?»</summary>
<p>Server GC — куча и поток GC на каждый процессор, выше пропускная способность, больше памяти; Workstation — одна куча, меньше памяти. ASP.NET Core по умолчанию использует Server GC, а при одном процессоре рантайм всё равно выбирает Workstation. Раньше Server GC без CPU limit на большом узле создавал десятки куч и съедал много памяти. DATAS динамически подстраивает число куч под нагрузку, начиная с одной; в .NET 9 он включён по умолчанию для Server GC, и это в основном решает проблему. Если важна максимальная пропускная способность, а память не ограничена, DATAS можно выключить, но решение стоит принимать по нагрузочному тесту.</p>
</details>
<details><summary>«Как сделать graceful shutdown ASP.NET Core в Kubernetes?»</summary>
<p>На SIGTERM Generic Host вызывает StopApplication, срабатывает ApplicationStopping, затем <code>StopAsync</code> у hosted services: Kestrel перестаёт принимать соединения и дожидается текущих запросов, BackgroundService получают отмену токена. Всё это ограничено <code>HostOptions.ShutdownTimeout</code>, по умолчанию 30 секунд. Его нужно согласовать с <code>terminationGracePeriodSeconds</code> пода: preStop плюс ShutdownTimeout должны быть меньше grace period, иначе придёт SIGKILL. Фоновые сервисы должны пробрасывать <code>stoppingToken</code>, консьюмеры — коммитить offset и закрываться. И нужен preStop с небольшой паузой, потому что под удаляется из эндпоинтов параллельно с SIGTERM, и несколько секунд на него ещё приходит трафик.</p>
</details>
<details><summary>«Сервис в поде с лимитом 1 CPU отвечает секундами, но CPU почти не занят. Что проверите?»</summary>
<p>Первое подозрение — thread pool starvation. При лимите 1 CPU <code>ProcessorCount</code> равен 1, и минимум пула потоков — один поток; сверх него пул добавляет потоки медленно. Любой блокирующий вызов (sync-over-async, <code>.Result</code>, синхронный I/O) быстро занимает все потоки, а запросы ждут в очереди. Проверяю <code>dotnet-counters</code>: длина очереди пула и число потоков растут, CPU низкий. Второе подозрение — CPU throttling: короткие всплески упираются в квоту, видно по метрике <code>container_cpu_cfs_throttled_periods_total</code>. Лечение первого — убрать блокирующий код, второго — пересмотреть лимит.</p>
</details>
<details><summary>«Что такое invariant globalization mode и чем он опасен для русского приложения?»</summary>
<p>Это режим, в котором .NET не использует ICU и все культуры ведут себя как инвариантная. Он уменьшает образ и включён по умолчанию в Alpine- и обычных chiseled-образах .NET. Последствия: даты и числа форматируются не по-русски, сортировка и сравнение строк — по кодам символов, а создание культуры <code>ru-RU</code> бросает <code>CultureNotFoundException</code>. Если приложение локализует ответы или форматирует что-то для людей, нужен образ с ICU — <code>-chiseled-extra</code> или установленный пакет. Проверять нужно в том же образе, что и в продакшене, потому что на машине разработчика ICU есть.</p>
</details>
<details><summary>«Почему FindSystemTimeZoneById работает локально и падает в контейнере?»</summary>
<p>На Linux часовые пояса читаются из <code>/usr/share/zoneinfo</code> пакета tzdata, а в минимальных образах (chiseled без <code>-extra</code>, иногда Alpine) его нет — отсюда <code>TimeZoneNotFoundException</code>. Если ищут Windows-идентификатор вроде <code>Russian Standard Time</code>, преобразование в IANA требует ещё и ICU. Решения: образ с tzdata и ICU, IANA-идентификаторы, или NodaTime со встроенной базой TZDB. И в целом не полагаться на часовой пояс контейнера: держать UTC и переводить явно.</p>
</details>
`
    },
    {
      id: 'k8s-basics',
      title: 'Kubernetes: основы',
      html: `
<h3>Идея: желаемое состояние и циклы согласования</h3>
<p>Kubernetes — это не «запускатель контейнеров», а <strong>система согласования состояния</strong>. Вы описываете желаемое состояние объектами API («три реплики образа <code>api:1.4.2</code>, каждая с 512 МБ памяти, доступные по имени <code>polestar-api</code>»), а набор <strong>контроллеров</strong> бесконечно сравнивает его с фактическим и устраняет разницу. Упал узел — контроллер видит две реплики вместо трёх и создаёт третью на другом узле. Кто-то вручную удалил под — то же самое.</p>
<p>Из этой модели вытекает почти всё:</p>
<ul>
<li>Манифесты <strong>декларативные</strong>: <code>kubectl apply</code> отправляет желаемое состояние, а не последовательность команд. Повторное применение того же файла ничего не меняет — операция идемпотентна.</li>
<li>У объекта есть <code>spec</code> (чего хотим) и <code>status</code> (что есть сейчас, его пишут контроллеры).</li>
<li>Всё <strong>в конечном счёте согласованно</strong>: после <code>apply</code> поды появятся не мгновенно, и «команда выполнилась» не значит «приложение работает». Отсюда <code>kubectl rollout status</code> и флаги <code>--wait</code> в инструментах деплоя.</li>
<li>Компоненты общаются только через API-сервер, а не друг с другом. Это делает систему расширяемой: свой контроллер с собственным ресурсом (CRD) — оператор — работает по тем же правилам, что встроенные.</li>
</ul>

<h3>Control plane и узлы</h3>
<p><strong>Control plane</strong> (управляющий слой):</p>
<ul>
<li><strong>kube-apiserver</strong> — единственная точка входа. REST API, аутентификация, авторизация (RBAC), admission-контроллеры (валидация и изменение объектов при создании), запись в хранилище. <code>kubectl</code>, контроллеры, kubelet — все ходят сюда.</li>
<li><strong>etcd</strong> — распределённое key-value хранилище на основе Raft, где лежат все объекты кластера. Потеря etcd без бэкапа — потеря кластера. Секреты по умолчанию лежат в нём незашифрованными (подробно в главе о секретах).</li>
<li><strong>kube-scheduler</strong> — выбирает узел для каждого нового пода: отсеивает неподходящие (не хватает ресурсов по requests, taints, nodeSelector и affinity, топология томов) и ранжирует оставшиеся. Сам под он не запускает — только записывает в него имя узла.</li>
<li><strong>kube-controller-manager</strong> — встроенные контроллеры: Deployment, ReplicaSet, Node, Job, EndpointSlice, ServiceAccount и другие.</li>
<li><strong>cloud-controller-manager</strong> — интеграция с облаком: балансировщики для Service типа LoadBalancer, маршруты, информация об узлах.</li>
</ul>
<p><strong>Рабочие узлы</strong> (worker nodes):</p>
<ul>
<li><strong>kubelet</strong> — агент на узле. Видит поды, назначенные его узлу, и через CRI просит container runtime их запустить; выполняет пробы; монтирует тома; сообщает статус в API-сервер; вытесняет поды при нехватке ресурсов узла.</li>
<li><strong>container runtime</strong> — containerd или CRI-O.</li>
<li><strong>kube-proxy</strong> — реализует Service: программирует iptables или IPVS так, чтобы трафик на виртуальный IP сервиса уходил на поды. Некоторые CNI-плагины (например, Cilium на eBPF) заменяют kube-proxy целиком.</li>
<li><strong>CNI-плагин</strong> (Calico, Cilium, Flannel) — сеть подов: каждый под получает свой IP, и все поды могут общаться друг с другом без NAT. Он же реализует <code>NetworkPolicy</code>.</li>
</ul>
<p>В управляемых кластерах (Yandex Managed Service for Kubernetes, VK Cloud, облака за рубежом) control plane обслуживает провайдер, и вы видите только узлы.</p>

<h3>Pod — минимальная единица</h3>
<p><strong>Pod</strong> — один или несколько контейнеров, которые всегда планируются на один узел и разделяют сетевой namespace (общий IP, общий <code>localhost</code>, общее пространство портов) и тома. Под — единица планирования, масштабирования и жизни: контейнеры пода стартуют и умирают вместе с ним.</p>
<p>Ключевые свойства:</p>
<ul>
<li><strong>Поды эфемерны.</strong> Под не «переезжает» на другой узел и не «чинится» — контроллер создаёт новый под с новым именем и новым IP. Поэтому к подам никогда не обращаются по IP; для этого есть Service.</li>
<li><strong>Голый под никто не перезапустит</strong> при потере узла. Под почти всегда создаётся контроллером: Deployment, StatefulSet, DaemonSet, Job.</li>
<li><strong>Несколько контейнеров в поде</strong> — для тесно связанных процессов: sidecar-прокси сервис-меша (Envoy), агент сбора логов, процесс обновления сертификатов. Не для «API и база в одном поде»: их нужно масштабировать и обновлять независимо.</li>
<li><strong>Init containers</strong> выполняются последовательно до основных контейнеров, и каждый должен завершиться успешно: подготовить файл, дождаться зависимости, применить миграцию (о минусах последнего — в главе о деплое).</li>
<li><strong>Нативные sidecar-ы</strong>: init container с <code>restartPolicy: Always</code> запускается до основных контейнеров, работает всё время жизни пода и останавливается после них. Это решило давние проблемы: прокси-sidecar, который умирает раньше приложения, и Job, который никогда не завершается, потому что sidecar продолжает работать. Функция включена по умолчанию с Kubernetes 1.29.</li>
</ul>
<p>Самый важный для бэкенд-разработчика раздел спецификации пода — контейнер: образ, команда, порты, переменные окружения, <code>resources</code> (requests и limits), пробы, <code>securityContext</code> (UID, read-only корень, запрет повышения привилегий), монтирование томов.</p>

<h3>ReplicaSet и Deployment</h3>
<p><strong>ReplicaSet</strong> поддерживает заданное число одинаковых подов, отобранных по label selector. Напрямую его почти не используют: им управляет Deployment.</p>
<p><strong>Deployment</strong> — стандартный способ запускать stateless-сервисы. Он владеет ReplicaSet-ами: при изменении шаблона пода (новый образ, новая переменная) создаётся новый ReplicaSet, и Deployment постепенно переносит реплики со старого на новый — это rolling update. Старые ReplicaSet-ы с нулём реплик хранятся для отката (<code>revisionHistoryLimit</code>, по умолчанию 10).</p>
<pre><code>apiVersion: apps/v1
kind: Deployment
metadata:
  name: polestar-api
  namespace: polestar
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: polestar-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: polestar-api
    spec:
      containers:
        - name: api
          image: registry.example.com/polestar-api:1.4.2
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: ASPNETCORE_ENVIRONMENT
              value: Production
          resources:
            requests:
              cpu: 250m
              memory: 512Mi
            limits:
              memory: 512Mi</code></pre>
<p>Важные детали: <code>selector</code> должен совпадать с метками шаблона, и после создания Deployment менять его нельзя. Новый ReplicaSet создаётся только при изменении <code>template</code>; изменение <code>replicas</code> лишь масштабирует текущий. Поэтому смена ConfigMap, на который ссылается под, сама по себе не перезапускает поды — шаблон-то не изменился.</p>
<p>Другие контроллеры, которые надо уметь назвать:</p>
<ul>
<li><strong>StatefulSet</strong> — для приложений с идентичностью и состоянием: стабильные имена подов (<code>kafka-0</code>, <code>kafka-1</code>), свой PersistentVolumeClaim у каждой реплики, упорядоченный запуск и остановка. Базы, Kafka, ZooKeeper, Elasticsearch.</li>
<li><strong>DaemonSet</strong> — по одному поду на каждом (или выбранном) узле: агенты логов и метрик, CNI, node exporter.</li>
<li><strong>Job</strong> — под, который должен успешно завершиться (миграция, разовая обработка), с повторами (<code>backoffLimit</code>); <strong>CronJob</strong> — Job по расписанию.</li>
</ul>

<h3>Service: стабильный адрес для подов</h3>
<p><strong>Service</strong> даёт набору подов, выбранных по меткам, стабильное имя и виртуальный IP. Контроллер EndpointSlice следит, какие поды подходят под селектор <strong>и готовы</strong> (прошли readiness probe), и записывает их адреса в EndpointSlice-объекты; kube-proxy на каждом узле настраивает перенаправление трафика.</p>
<pre><code>apiVersion: v1
kind: Service
metadata:
  name: polestar-api
  namespace: polestar
spec:
  selector:
    app.kubernetes.io/name: polestar-api
  ports:
    - name: http
      port: 80
      targetPort: http</code></pre>
<p><code>port</code> — порт сервиса, <code>targetPort</code> — порт контейнера (можно по имени, тогда смена номера порта в поде не ломает сервис). Типы:</p>
<table>
<thead><tr><th>Тип</th><th>Что даёт</th></tr></thead>
<tbody>
<tr><td><code>ClusterIP</code> (по умолчанию)</td><td>Виртуальный IP, доступный только внутри кластера. Для межсервисного общения</td></tr>
<tr><td><code>NodePort</code></td><td>Плюс порт из диапазона 30000–32767 на каждом узле, через который сервис доступен снаружи по IP любого узла</td></tr>
<tr><td><code>LoadBalancer</code></td><td>Плюс внешний балансировщик облака, направляющий трафик на NodePort-ы (или прямо на поды)</td></tr>
<tr><td><code>ExternalName</code></td><td>DNS-псевдоним (CNAME) на внешнее имя, без проксирования</td></tr>
<tr><td>Headless (<code>clusterIP: None</code>)</td><td>Без виртуального IP: DNS возвращает IP всех готовых подов. Для StatefulSet и клиентской балансировки</td></tr>
</tbody>
</table>
<p><strong>DNS</strong>: сервис доступен как <code>polestar-api</code> из своего namespace, как <code>polestar-api.polestar</code> из другого и полностью как <code>polestar-api.polestar.svc.cluster.local</code>.</p>
<p>Тонкость, о которой спрашивают на senior-уровне: kube-proxy балансирует <strong>соединения</strong>, а не запросы. HTTP/1.1 keep-alive и особенно <strong>gRPC</strong> (HTTP/2, одно долгое соединение с мультиплексированием) приводят к тому, что клиент держит одно соединение с одним подом, и новые реплики после масштабирования не получают трафика. Решения: headless-сервис с клиентской балансировкой (в .NET gRPC — <code>dns:///</code> адрес и политика <code>round_robin</code>), сервис-меш (Istio, Linkerd), балансирующий запросы на L7, или периодическое пересоздание соединений.</p>

<h3>Ingress и Gateway API</h3>
<p>Service типа LoadBalancer на каждый микросервис — дорого и неудобно. Для HTTP-трафика снаружи используют L7-маршрутизацию по хосту и пути, с TLS-терминацией в одном месте.</p>
<p><strong>Ingress</strong> — объект с правилами «хост и путь → сервис». Сам по себе он ничего не делает: нужен <strong>Ingress controller</strong> (ingress-nginx, Traefik, HAProxy, облачные), который читает объекты Ingress и настраивает свой прокси.</p>
<pre><code>apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: polestar
spec:
  ingressClassName: nginx
  tls:
    - hosts: ["app.example.com"]
      secretName: app-tls
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: polestar-api
                port:
                  name: http</code></pre>
<p>Слабость Ingress — бедная стандартная модель: всё, что выходит за «хост и путь» (переписывание путей, таймауты, размер тела, канареечные веса, CORS), делается <strong>аннотациями конкретного контроллера</strong>, которые не переносимы и не валидируются. API Ingress заморожен: он стабилен и поддерживается, но новых возможностей в нём не будет. Отдельно: проект ingress-nginx, самый популярный контроллер, выведен из поддержки — SIG Network и Security Response Committee объявили об этом в ноябре 2025 года, и после марта 2026 года у него нет ни релизов, ни исправлений уязвимостей. Существующим установкам рекомендовано мигрировать на Gateway API или другой Ingress-контроллер, в новых кластерах его не ставят.</p>
<p><strong>Gateway API</strong> — преемник Ingress, стабильный с версии v1.0 (2023), реализуется отдельно от ядра Kubernetes через CRD. Модель разделена по ролям:</p>
<ul>
<li><strong>GatewayClass</strong> — какой реализацией обрабатывать (Envoy Gateway, Istio, Cilium, NGINX Gateway Fabric, Traefik, Kong) — уровень провайдера инфраструктуры;</li>
<li><strong>Gateway</strong> — конкретная точка входа: слушатели, порты, TLS-сертификаты — уровень администратора кластера;</li>
<li><strong>HTTPRoute</strong> (а также <code>GRPCRoute</code> и другие) — маршруты приложения, которые пишет команда сервиса в своём namespace.</li>
</ul>
<pre><code>apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: polestar-api
spec:
  parentRefs:
    - name: public-gateway
      namespace: gateway
  hostnames: ["app.example.com"]
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api
      backendRefs:
        - name: polestar-api
          port: 80
          weight: 90
        - name: polestar-api-canary
          port: 80
          weight: 10</code></pre>
<p>Что выразимо стандартно, без аннотаций: сопоставление по заголовкам и параметрам запроса, веса между бэкендами (канарейка), переписывание путей и заголовков, зеркалирование трафика, маршруты из разных namespace к одному шлюзу с явным разрешением.</p>

<h3>ConfigMap, Secret, namespaces, labels</h3>
<p><strong>ConfigMap</strong> — несекретная конфигурация в виде пар ключ–значение или целых файлов; передаётся в под переменными окружения или томом. <strong>Secret</strong> — то же для чувствительных данных, но значения закодированы в base64, что не является шифрованием. Подробности, включая обновление и внешние хранилища, — в главе о конфигурации.</p>
<p><strong>Namespace</strong> — логическое разделение кластера: имена объектов уникальны внутри namespace, на него вешаются RBAC, квоты (<code>ResourceQuota</code>, <code>LimitRange</code>) и сетевые политики. Типичное разделение — по командам или по окружениям (<code>polestar-dev</code>, <code>polestar-staging</code>). Namespace — это не граница безопасности сама по себе: без NetworkPolicy поды разных namespace свободно общаются по сети. Некоторые ресурсы кластерные и вне namespace: узлы, PersistentVolume, ClusterRole, StorageClass, CRD.</p>
<p><strong>Labels</strong> — пары ключ–значение на любых объектах, по которым ими оперируют другие объекты. На метках держится всё связывание в Kubernetes: Deployment находит свои поды по селектору, Service — свои эндпоинты, NetworkPolicy — к кому применяется, ServiceMonitor — что собирать. Рекомендованные метки — <code>app.kubernetes.io/name</code>, <code>app.kubernetes.io/instance</code>, <code>app.kubernetes.io/version</code>, <code>app.kubernetes.io/component</code>. <strong>Annotations</strong> — тоже ключ–значение, но не для отбора, а для произвольных метаданных инструментов: настройки Ingress-контроллера, хэш конфигурации, ссылка на сборку.</p>
<p>Классическая ошибка: Service с селектором, который не совпадает с метками подов (опечатка, лишняя метка версии). Поды работают, сервис существует, но запросы не проходят. Проверка: <code>kubectl get endpointslices -l kubernetes.io/service-name=polestar-api</code> — если адресов нет, проблема в селекторе или readiness.</p>

<h3>kubectl: что нужно уметь</h3>
<pre><code># контекст и namespace
kubectl config get-contexts
kubectl config use-context staging
kubectl config set-context --current --namespace=polestar

# что происходит
kubectl get pods -o wide
kubectl get pods -l app.kubernetes.io/name=polestar-api
kubectl get deploy,rs,svc,ingress
kubectl describe pod polestar-api-7d9f8b-x2k4q
kubectl get events --sort-by=.lastTimestamp

# логи и доступ
kubectl logs deploy/polestar-api -f
kubectl logs polestar-api-7d9f8b-x2k4q --previous
kubectl exec -it polestar-api-7d9f8b-x2k4q -- sh
kubectl port-forward svc/polestar-api 8080:80

# изменения
kubectl apply -f k8s/
kubectl diff -f k8s/
kubectl rollout status deploy/polestar-api
kubectl rollout history deploy/polestar-api
kubectl rollout undo deploy/polestar-api
kubectl rollout restart deploy/polestar-api
kubectl scale deploy/polestar-api --replicas=5

# справка и генерация
kubectl explain deployment.spec.strategy
kubectl create deployment x --image=nginx --dry-run=client -o yaml
kubectl top pods
kubectl auth can-i create pods -n polestar</code></pre>
<p>Комментарии к неочевидному: <code>logs --previous</code> показывает логи <strong>предыдущего</strong> запуска контейнера — единственный способ узнать, почему он упал в CrashLoopBackOff. <code>rollout restart</code> пересоздаёт поды без изменения образа (технически меняя аннотацию в шаблоне) — так применяют новую конфигурацию из ConfigMap. <code>diff</code> показывает, что изменит <code>apply</code>, — полезно перед ручным применением. <code>top</code> требует установленного metrics-server. <code>describe</code> — первое, что смотрят при любой проблеме с подом: внизу вывода события (Events) с причинами.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Из каких компонентов состоит кластер Kubernetes?»</summary>
<p>Control plane: kube-apiserver — единая точка входа с аутентификацией, авторизацией и admission; etcd — хранилище всех объектов; kube-scheduler — выбирает узел для нового пода по requests, taints, affinity; kube-controller-manager — встроенные контроллеры, которые приводят фактическое состояние к желаемому; cloud-controller-manager — интеграция с облаком. На узлах: kubelet запускает поды через container runtime (containerd, CRI-O), выполняет пробы и сообщает статус; kube-proxy реализует Service через iptables или IPVS; CNI-плагин даёт подам сеть. Все компоненты общаются через API-сервер, а не напрямую.</p>
</details>
<details><summary>«Чем Pod отличается от контейнера и зачем в поде несколько контейнеров?»</summary>
<p>Под — группа контейнеров, которые планируются на один узел, разделяют сетевой namespace (общий IP и localhost) и тома и живут вместе. Он — минимальная единица планирования и масштабирования. Несколько контейнеров кладут в под, когда процессы тесно связаны и должны масштабироваться вместе: sidecar-прокси сервис-меша, сборщик логов, обновление сертификатов, а также init containers для подготовки. API и базу в один под не кладут — их масштабируют и обновляют независимо. С 1.29 по умолчанию доступны нативные sidecar-ы — init containers с <code>restartPolicy: Always</code>, которые стартуют раньше и останавливаются позже основного контейнера.</p>
</details>
<details><summary>«Что делает Deployment и как он связан с ReplicaSet?»</summary>
<p>ReplicaSet поддерживает заданное число одинаковых подов по селектору. Deployment управляет ReplicaSet-ами: при изменении шаблона пода создаёт новый ReplicaSet и постепенно переносит реплики, соблюдая <code>maxSurge</code> и <code>maxUnavailable</code>. Старые ReplicaSet-ы с нулём реплик сохраняются, поэтому возможен <code>rollout undo</code>. Новый ReplicaSet появляется только при изменении <code>template</code>, а не <code>replicas</code>. Для stateful-приложений с идентичностью реплик используют StatefulSet, для агента на каждом узле — DaemonSet, для разовых задач — Job.</p>
</details>
<details><summary>«Какие типы Service бывают и когда какой?»</summary>
<p>ClusterIP — виртуальный IP только внутри кластера, для межсервисного общения, тип по умолчанию. NodePort — дополнительно открывает порт 30000–32767 на каждом узле. LoadBalancer — дополнительно создаёт внешний балансировщик облака. ExternalName — DNS-псевдоним на внешнее имя. Headless (<code>clusterIP: None</code>) — без виртуального IP, DNS отдаёт адреса всех готовых подов, это нужно StatefulSet-ам и клиентской балансировке. Для HTTP снаружи обычно один LoadBalancer перед Ingress-контроллером или Gateway, а сервисы приложений — ClusterIP.</p>
</details>
<details><summary>«Почему при gRPC новые реплики не получают трафик?»</summary>
<p>kube-proxy балансирует на уровне TCP-соединений: решение принимается один раз при установке соединения. gRPC работает поверх HTTP/2 и держит одно долгое соединение, по которому мультиплексирует все вызовы, поэтому клиент привязан к поду, выбранному при подключении. После масштабирования новые поды простаивают, а старые перегружены. Решения: headless Service и клиентская балансировка в .NET gRPC (резолвер DNS и политика round_robin), L7-прокси или сервис-меш, балансирующий отдельные запросы, либо ограничение времени жизни соединения. С HTTP/1.1 keep-alive и пулом соединений эффект похожий, но слабее.</p>
</details>
<details><summary>«Чем Gateway API лучше Ingress?»</summary>
<p>Ingress описывает только хост, путь и TLS, а всё остальное — переписывание, таймауты, канареечные веса, сопоставление по заголовкам — делается аннотациями конкретного контроллера, непереносимыми и непроверяемыми. API Ingress заморожен. Gateway API выражает эти возможности стандартными полями и разделяет ответственность по ролям: GatewayClass — реализация, Gateway — точка входа и сертификаты администратора кластера, HTTPRoute — маршруты команды приложения в своём namespace. Он поддерживает и другие протоколы (gRPC, TCP, TLS). Стабильная версия v1.0 вышла в 2023 году, реализаций много: Envoy Gateway, Istio, Cilium, NGINX Gateway Fabric и другие.</p>
</details>
<details><summary>«Service есть, поды Running, а запросы не доходят. Что проверите?»</summary>
<p>Сначала эндпоинты: <code>kubectl get endpointslices -l kubernetes.io/service-name=имя</code>. Если адресов нет — либо селектор Service не совпадает с метками подов (сравниваю <code>kubectl get svc -o yaml</code> и <code>kubectl get pods --show-labels</code>), либо поды не проходят readiness probe (видно в <code>describe pod</code> и в колонке READY). Если адреса есть — проверяю <code>targetPort</code>: совпадает ли он с портом, который реально слушает приложение (классика — 80 вместо 8080 у .NET 8+). Дальше — NetworkPolicy, запрещающая трафик, и правильность Ingress или HTTPRoute. Изнутри кластера проверяю запросом из временного пода с curl или через <code>port-forward</code> к поду напрямую, минуя сервис.</p>
</details>
`
    },
    {
      id: 'pod-lifecycle',
      title: 'Жизненный цикл пода',
      html: `
<h3>Фазы пода и состояния контейнеров</h3>
<p>У пода есть <strong>фаза</strong> (<code>status.phase</code>) — грубая сводка:</p>
<ul>
<li><strong>Pending</strong> — под принят, но ещё не работает: не назначен на узел (не хватает ресурсов, не подходят taints и affinity, не привязан том), или образ скачивается, или выполняются init containers.</li>
<li><strong>Running</strong> — под на узле, хотя бы один контейнер запущен. Это <em>не</em> значит, что приложение готово или здорово.</li>
<li><strong>Succeeded</strong> — все контейнеры завершились успешно и не будут перезапущены (Job).</li>
<li><strong>Failed</strong> — все контейнеры завершились, и хотя бы один — с ошибкой.</li>
<li><strong>Unknown</strong> — нет связи с kubelet узла.</li>
</ul>
<p>То, что <code>kubectl get pods</code> показывает в колонке STATUS (<code>CrashLoopBackOff</code>, <code>ImagePullBackOff</code>, <code>OOMKilled</code>, <code>Terminating</code>, <code>ContainerCreating</code>), — это не фаза, а сводка по <strong>состояниям контейнеров</strong>: <code>Waiting</code> (с причиной), <code>Running</code> или <code>Terminated</code> (с кодом выхода и причиной). Колонка READY (<code>2/3</code>) показывает, сколько контейнеров прошли readiness probe.</p>
<p>Кроме того, у пода есть <strong>conditions</strong>: <code>PodScheduled</code>, <code>Initialized</code>, <code>ContainersReady</code>, <code>Ready</code>. Именно <code>Ready</code> решает, попадёт ли под в эндпоинты Service.</p>
<p><strong>restartPolicy</strong> пода — <code>Always</code> (единственный вариант для Deployment), <code>OnFailure</code> или <code>Never</code> (для Job). При <code>Always</code> контейнер перезапускается даже после выхода с кодом 0 — веб-сервис не должен завершаться сам. Перезапуски идут с экспоненциальной задержкой (10 с, 20 с, 40 с… до пяти минут); пока kubelet ждёт следующей попытки, контейнер показывается как <code>CrashLoopBackOff</code>. Счётчик RESTARTS растёт.</p>

<h3>Три пробы: liveness, readiness, startup</h3>
<p>Kubelet периодически проверяет каждый контейнер. Способы проверки: <code>httpGet</code> (успех — код 200–399), <code>tcpSocket</code> (соединение установилось), <code>exec</code> (команда вернула 0; в chiseled-образах недоступно — нечего запускать) и <code>grpc</code> (стандартный gRPC health-протокол).</p>
<table>
<thead><tr><th>Проба</th><th>Вопрос</th><th>Что при провале</th></tr></thead>
<tbody>
<tr><td><strong>startup</strong></td><td>Приложение уже запустилось?</td><td>Пока не прошла, остальные пробы не выполняются. Если не прошла за <code>failureThreshold × periodSeconds</code> — контейнер перезапускается</td></tr>
<tr><td><strong>liveness</strong></td><td>Процесс жив или безнадёжно завис?</td><td>Контейнер <strong>убивается и перезапускается</strong></td></tr>
<tr><td><strong>readiness</strong></td><td>Можно ли сейчас слать трафик?</td><td>Под <strong>исключается из эндпоинтов</strong> Service, но не перезапускается. Когда проба снова проходит — возвращается</td></tr>
</tbody>
</table>
<p>Параметры и их значения по умолчанию: <code>initialDelaySeconds</code> (0), <code>periodSeconds</code> (10), <code>timeoutSeconds</code> (1), <code>failureThreshold</code> (3), <code>successThreshold</code> (1; для liveness и startup может быть только 1). Таймаут в одну секунду — частая причина ложных срабатываний: под нагрузкой или при сборке мусора ответ на пробу занимает больше секунды.</p>
<pre><code>startupProbe:
  httpGet:
    path: /health/live
    port: http
  periodSeconds: 5
  failureThreshold: 30     # до 150 секунд на старт
livenessProbe:
  httpGet:
    path: /health/live
    port: http
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3
readinessProbe:
  httpGet:
    path: /health/ready
    port: http
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 2</code></pre>
<p>Зачем startup probe, если есть <code>initialDelaySeconds</code>? Задержка одна на все случаи: поставите 60 секунд — каждый под будет минуту не проверяться и не получать трафик, даже если поднялся за три; поставите 10 — медленный холодный старт под CPU-лимитом будет убит liveness-пробой. Startup probe проверяет часто и долго терпит, а после первого успеха передаёт эстафету liveness с его короткими порогами.</p>

<h3>Health checks в ASP.NET Core</h3>
<p>ASP.NET Core содержит готовую инфраструктуру проверок здоровья. Регистрируются проверки, помеченные тегами, и несколько эндпоинтов отбирают их по тегам:</p>
<pre><code>builder.Services.AddHealthChecks()
    .AddCheck("self", () =&gt; HealthCheckResult.Healthy(),
        tags: ["live"])
    .AddNpgSql(connectionString, tags: ["ready"])
    .AddCheck&lt;WarmupHealthCheck&gt;("warmup", tags: ["ready"]);

var app = builder.Build();

app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = check =&gt; check.Tags.Contains("live")
}).AllowAnonymous();

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check =&gt; check.Tags.Contains("ready")
}).AllowAnonymous();</code></pre>
<p>Детали:</p>
<ul>
<li><code>AddNpgSql</code>, <code>AddRedis</code>, <code>AddKafka</code> и подобные — из популярного community-набора <code>AspNetCore.HealthChecks.*</code>; для EF Core есть <code>AddDbContextCheck&lt;TContext&gt;()</code> от Microsoft.</li>
<li>Своя проверка — класс, реализующий <code>IHealthCheck</code>. Например, <code>WarmupHealthCheck</code> возвращает Unhealthy, пока фоновый прогрев (загрузка справочников в кэш, первое подключение к брокеру) не закончился.</li>
<li>Эндпоинты проверок обычно открывают без аутентификации и исключают из логирования запросов и метрик, иначе пробы засоряют логи и искажают статистику латентности.</li>
<li>По умолчанию проверки выполняются на каждый запрос. Если проверка дорогая, а проб много, кэшируйте результат или используйте <code>IHealthCheckPublisher</code> для периодического выполнения.</li>
<li>Если liveness предикат возвращает <code>false</code> для всех проверок (<code>Predicate = _ =&gt; false</code>), эндпоинт отвечает 200, пока приложение в принципе обслуживает HTTP. Это самый честный liveness для веб-сервиса.</li>
</ul>
<p>Для ответа в JSON с деталями каждой проверки задают <code>ResponseWriter</code>, но наружу детали (строки подключения в сообщениях исключений, версии) лучше не отдавать.</p>

<h3>Что нельзя класть в liveness</h3>
<p>Главное правило: <strong>liveness проверяет только сам процесс</strong>. Перезапуск поможет, только если проблема внутри процесса: дедлок, исчерпанный пул потоков, повреждённое состояние. Если проблема снаружи, перезапуск её не решит, а сделает хуже.</p>
<p>Сценарий катастрофы. В liveness включена проверка PostgreSQL. База на 30 секунд недоступна (failover, перезагрузка). Все реплики всех сервисов одновременно проваливают liveness, kubelet их перезапускает. Через 30 секунд база вернулась — и получила одновременный шторм подключений от сотни стартующих подов, прогрев кэшей, миграции. База снова падает, поды снова в CrashLoopBackOff, задержка между перезапусками растёт до минут. Короткий сбой зависимости превратился в долгую аварию всей системы, а сами сервисы, которые могли бы отдавать кэшированные данные или понятные ошибки, лежат.</p>
<p>Поэтому:</p>
<ul>
<li><strong>В liveness — никаких внешних зависимостей</strong>: ни базы, ни брокера, ни соседних сервисов, ни Keycloak.</li>
<li><strong>В readiness — осторожно.</strong> Зависимость в readiness уберёт под из балансировки, когда она недоступна. Это разумно, если без неё сервис бесполезен и <em>другие</em> реплики могут работать (например, у каждой реплики своё соединение, и сломалось только оно). Но если база недоступна для всех, все реплики станут неготовыми одновременно, и клиенты получат ошибку соединения от балансировщика вместо осмысленного 503 от приложения. Многие команды поэтому держат в readiness только «приложение прогрелось и не останавливается», а зависимости проверяют в отдельном диагностическом эндпоинте для мониторинга.</li>
<li><strong>Проба должна быть дешёвой.</strong> Она выполняется каждые несколько секунд на каждой реплике.</li>
<li><strong>Порог liveness должен быть терпимым</strong>: долгая пауза GC или кратковременная перегрузка не должны приводить к рестарту. Рестарт под нагрузкой уменьшает число реплик и добивает оставшиеся.</li>
</ul>
<p>Ещё одна грабля: одинаковые эндпоинты для liveness и readiness с проверкой зависимостей. Тогда readiness теряет смысл — под не убирают из трафика, а убивают.</p>

<h3>Как под завершается</h3>
<p>Под удаляется при rolling update, масштабировании вниз, drain узла, вытеснении. Последовательность:</p>
<ol>
<li>API-сервер помечает под удаляемым (<code>deletionTimestamp</code>), он показывается как <code>Terminating</code>.</li>
<li><strong>Параллельно и независимо</strong> происходят две вещи:
<ul>
<li>контроллер EndpointSlice убирает под из эндпоинтов, после чего kube-proxy на каждом узле, ingress-контроллеры и сервис-меш обновляют свои таблицы маршрутизации — каждый в своём темпе;</li>
<li>kubelet на узле пода выполняет <strong>preStop hook</strong> (если задан), а после его завершения отправляет <strong>SIGTERM</strong> главному процессу каждого контейнера.</li>
</ul></li>
<li>Kubelet ждёт завершения контейнеров не дольше <code>terminationGracePeriodSeconds</code> (по умолчанию 30 секунд). Отсчёт начинается с начала удаления и <strong>включает время preStop</strong>.</li>
<li>Кто не завершился — получает <strong>SIGKILL</strong>.</li>
<li>Нативные sidecar-контейнеры останавливаются после основных, так что прокси сервис-меша обслуживает запросы приложения до конца.</li>
</ol>
<p>Ключевое слово — «параллельно». Нет никакой гарантии, что к моменту SIGTERM весь кластер уже знает, что под уходит.</p>

<h3>Гонка эндпоинтов и preStop</h3>
<p>Что происходит без подготовки. Под получил SIGTERM, ASP.NET Core сразу останавливает Kestrel: новые соединения больше не принимаются. Но ingress-контроллер и kube-proxy на других узлах ещё секунду-две (а под нагрузкой на большом кластере и дольше) продолжают слать сюда новые запросы — и клиенты получают <code>connection refused</code> или 502. При каждом деплое — всплеск ошибок, хотя «graceful shutdown настроен».</p>
<p>Решение — <strong>задержать начало остановки</strong> на несколько секунд, пока маршрутизация не обновится, продолжая всё это время обслуживать запросы:</p>
<pre><code>spec:
  terminationGracePeriodSeconds: 45
  containers:
    - name: api
      lifecycle:
        preStop:
          sleep:
            seconds: 10</code></pre>
<p>Встроенное действие <code>sleep</code> у lifecycle-хуков появилось сравнительно недавно (бета и включено по умолчанию начиная с 1.30, стабильно с 1.34). Раньше писали <code>exec: { command: ["sleep", "10"] }</code>, но в chiseled и distroless-образах нет бинарника <code>sleep</code>, и такой хук падает (kubelet пишет событие FailedPreStopHook и сразу переходит к SIGTERM). Если кластер старый и образ минимальный — задержку делают в самом приложении: в .NET 8+ через <code>IHostedLifecycleService.StoppingAsync</code> с <code>Task.Delay</code>, которая выполняется до остановки Kestrel.</p>
<p>Итоговый бюджет времени: <code>preStop</code> (5–10 с) + дренирование текущих запросов (до <code>HostOptions.ShutdownTimeout</code>) &lt; <code>terminationGracePeriodSeconds</code>. Для сервисов с долгими запросами, WebSocket-соединениями или длинной обработкой сообщений grace period увеличивают до минут.</p>
<p>Полезно также переводить readiness в Unhealthy по <code>ApplicationStopping</code>: это не ускоряет удаление из эндпоинтов (оно начинается само при удалении пода), но помогает балансировщикам, которые сами опрашивают здоровье бэкендов.</p>

<h3>Rolling update: maxSurge и maxUnavailable</h3>
<p>Стратегия Deployment по умолчанию — <code>RollingUpdate</code> с двумя параметрами:</p>
<ul>
<li><strong>maxSurge</strong> — сколько подов можно создать сверх желаемого числа (по умолчанию 25%, округление вверх);</li>
<li><strong>maxUnavailable</strong> — сколько подов может быть недоступно от желаемого числа (по умолчанию 25%, округление вниз).</li>
</ul>
<p>Пример: 3 реплики с настройками по умолчанию дают surge = 1 и unavailable = 0. Контроллер создаёт один новый под, ждёт, пока он станет Ready, удаляет один старый, и так далее. Ёмкость никогда не падает ниже трёх, но нужны ресурсы на четвёртый под. <code>maxSurge: 0, maxUnavailable: 1</code> — обновление без дополнительных ресурсов ценой временной потери одной реплики. Оба нуля одновременно запрещены — обновление не могло бы сдвинуться.</p>
<p>Связанные поля:</p>
<ul>
<li><code>minReadySeconds</code> — сколько секунд под должен быть Ready без падений, прежде чем считаться доступным. Защищает от образа, который проходит readiness и падает через 10 секунд.</li>
<li><code>progressDeadlineSeconds</code> (по умолчанию 600) — если выкатка не продвигается дольше, Deployment получает условие <code>Progressing=False</code> с причиной <code>ProgressDeadlineExceeded</code>. <strong>Автоматического отката нет</strong>: Deployment просто останавливается в полуобновлённом состоянии, а откатывает CI/CD (<code>helm --atomic</code>, Argo Rollouts) или человек (<code>kubectl rollout undo</code>).</li>
<li>Стратегия <code>Recreate</code> — сначала удалить все старые поды, потом создать новые. Простой гарантирован, зато две версии никогда не работают одновременно; нужна, например, для приложения, которое держит эксклюзивную блокировку или том ReadWriteOnce.</li>
</ul>
<p>Главное архитектурное следствие rolling update: какое-то время <strong>обе версии работают одновременно</strong> и обслуживают одних и тех же клиентов, одну базу и одни топики. Поэтому изменения API, схемы базы и форматов сообщений должны быть обратно совместимыми на шаг: новая версия понимает старые данные, старая не ломается от новых. Отсюда паттерн expand/contract для миграций (глава о деплое).</p>
<p>И ещё: readiness — это то, что двигает rolling update. Если readiness всегда возвращает 200 сразу после старта процесса, Kubernetes будет считать неготовый под готовым и снимет старые поды раньше времени.</p>

<h3>PodDisruptionBudget</h3>
<p><strong>Добровольные нарушения</strong> (voluntary disruptions) — это удаление подов по инициативе людей и автоматики: <code>kubectl drain</code> при обслуживании или обновлении узла, уменьшение кластера автоскейлером, вытеснение через Eviction API. <strong>PodDisruptionBudget</strong> ограничивает, сколько подов приложения может быть недоступно одновременно из-за таких действий:</p>
<pre><code>apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: polestar-api
spec:
  minAvailable: 2          # или maxUnavailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: polestar-api</code></pre>
<p>Если вытеснение нарушило бы бюджет, Eviction API отказывает, и <code>drain</code> ждёт, пока где-то не поднимется замена. Без PDB drain узла, на котором оказались все три реплики, удалит их разом.</p>
<p>Чего PDB <strong>не</strong> защищает:</p>
<ul>
<li>от недобровольных нарушений: падения узла, OOMKilled, kernel panic, отключения зоны;</li>
<li>от прямого удаления подов (<code>kubectl delete pod</code>) и удаления Deployment — они не используют Eviction API;</li>
<li>от rolling update самого Deployment — его ограничивает собственный <code>maxUnavailable</code>.</li>
</ul>
<p>Типичные ошибки: <code>minAvailable</code>, равный числу реплик, или <code>minAvailable: 1</code> (<code>maxUnavailable: 0</code>) на приложении с одной репликой — тогда ни один под никогда нельзя вытеснить, и обслуживание узлов блокируется навсегда, пока администратор не удалит PDB. Разумная настройка — <code>maxUnavailable: 1</code> при двух и более репликах, плюс распределение реплик по узлам (anti-affinity, topology spread), иначе PDB мало помогает при падении узла.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Чем отличаются liveness, readiness и startup probes?»</summary>
<p>Liveness отвечает на вопрос, жив ли процесс; при провале kubelet убивает и перезапускает контейнер. Readiness — готов ли под принимать трафик; при провале под убирается из эндпоинтов Service, но не перезапускается, и возвращается, когда проба снова проходит. Startup — завершился ли старт; пока она не прошла, liveness и readiness не выполняются, а если не прошла за отведённое время, контейнер перезапускается. Startup нужна медленно стартующим приложениям, чтобы не ставить огромный <code>initialDelaySeconds</code> на liveness. Readiness, кроме прочего, управляет rolling update: новый под считается доступным только после неё.</p>
</details>
<details><summary>«Почему нельзя проверять базу данных в liveness probe?»</summary>
<p>Перезапуск помогает, только если проблема внутри процесса. Если база временно недоступна, liveness провалится у всех реплик сразу, и kubelet перезапустит их все. Сервисы перестают отвечать даже тем, что могли бы отдать без базы, а когда база возвращается, получает шторм подключений от одновременно стартующих подов и может снова упасть. Задержки CrashLoopBackOff растут, и короткий сбой превращается в долгую аварию. Liveness должна проверять только способность процесса обслуживать запросы; зависимости — в readiness, и то осторожно, или в отдельном диагностическом эндпоинте для мониторинга.</p>
</details>
<details><summary>«Опишите, что происходит, когда под удаляется»</summary>
<p>Под помечается Terminating, после чего параллельно идут два процесса. Контроллер EndpointSlice удаляет под из эндпоинтов, и kube-proxy, ingress-контроллеры и меш постепенно обновляют маршрутизацию. Одновременно kubelet выполняет preStop hook, затем шлёт SIGTERM главным процессам контейнеров и ждёт до <code>terminationGracePeriodSeconds</code>, по умолчанию 30 секунд, считая и время preStop. Не завершившиеся контейнеры получают SIGKILL. Из-за параллельности под может получить SIGTERM, пока на него ещё идёт трафик, поэтому нужен preStop с задержкой. Нативные sidecar-ы останавливаются после основных контейнеров.</p>
</details>
<details><summary>«При каждом деплое бывает всплеск 502. Graceful shutdown настроен. В чём дело?»</summary>
<p>Почти наверняка гонка между удалением пода из эндпоинтов и SIGTERM. Kestrel перестаёт принимать соединения сразу по сигналу, а ingress и kube-proxy ещё несколько секунд отправляют на под новые запросы. Решение — preStop hook со sleep 5–10 секунд (встроенное действие <code>sleep</code> или задержка в самом приложении, если образ chiseled и бинарника <code>sleep</code> нет) и grace period, вмещающий задержку и дренирование. Ещё стоит проверить, что новые поды не получают трафик раньше готовности (readiness, а не голый TCP), и что <code>maxUnavailable</code> не снимает слишком много старых подов разом. Для gRPC и keep-alive соединений — что клиенты корректно переподключаются.</p>
</details>
<details><summary>«Как работают maxSurge и maxUnavailable? Что будет с тремя репликами по умолчанию?»</summary>
<p>maxSurge — сколько подов можно создать сверх желаемого числа, maxUnavailable — сколько может отсутствовать; оба по умолчанию 25%, surge округляется вверх, unavailable вниз. Для трёх реплик это surge 1 и unavailable 0: создаётся один новый под, после его готовности удаляется один старый, и так три раза; ёмкость не падает, но нужен ресурс на четвёртый под. Если ресурсов нет, ставят <code>maxSurge: 0, maxUnavailable: 1</code>. Два нуля одновременно запрещены. Обновление останавливается, если новые поды не становятся готовыми, а после <code>progressDeadlineSeconds</code> Deployment помечается как непродвигающийся — без автоматического отката.</p>
</details>
<details><summary>«Что такое PodDisruptionBudget и от чего он не защищает?»</summary>
<p>PDB ограничивает число подов приложения, которые могут быть недоступны из-за добровольных нарушений через Eviction API: drain узла, уменьшение кластера автоскейлером, обновление узлов. Задаётся через <code>minAvailable</code> или <code>maxUnavailable</code> и селектор. Не защищает от падения узла, OOMKilled и других недобровольных событий, от прямого <code>kubectl delete pod</code> и от rolling update самого Deployment, который ограничивает свой <code>maxUnavailable</code>. Ошибка — <code>minAvailable</code>, равный числу реплик, или <code>minAvailable: 1</code> на единственной реплике: drain блокируется навсегда.</p>
</details>
<details><summary>«Медленно стартующий сервис убивается при запуске. Как настроить пробы?»</summary>
<p>Liveness начинает проверять до того, как приложение поднялось, и после нескольких провалов убивает контейнер — он стартует заново и снова не успевает. Правильный инструмент — startup probe с частой проверкой и большим <code>failureThreshold</code>: например, раз в 5 секунд до 30 раз. Пока она не прошла, liveness не выполняется; после успеха liveness работает с короткими порогами. Заодно стоит разобраться, почему старт медленный: под CPU-лимитом JIT и инициализация троттлятся, помогают ReadyToRun, больший лимит или прогрев в фоне с readiness, зависящей от его окончания.</p>
</details>
`
    },
    {
      id: 'resources',
      title: 'Ресурсы и масштабирование',
      html: `
<h3>Requests и limits — это ответы на разные вопросы</h3>
<p>У каждого контейнера в <code>resources</code> есть два набора чисел, и путать их — самая распространённая ошибка:</p>
<ul>
<li><strong>requests</strong> — сколько контейнеру <em>гарантировано</em>. По requests работает <strong>планировщик</strong>: под попадёт только на узел, где сумма requests уже размещённых подов плюс requests нового не превышает выделяемых ресурсов узла (allocatable). Фактическое потребление планировщик не смотрит. Кроме того, CPU request превращается в вес cgroup: при конкуренции за процессор контейнер получает долю, пропорциональную своему request.</li>
<li><strong>limits</strong> — <em>потолок</em>, который обеспечивает ядро на узле. CPU limit превращается в CFS-квоту, и при её исчерпании процесс троттлится. Memory limit превращается в <code>memory.max</code>, и при его превышении контейнер убивается (OOMKilled).</li>
</ul>
<pre><code>resources:
  requests:
    cpu: 500m
    memory: 768Mi
  limits:
    memory: 768Mi</code></pre>
<p>Единицы. CPU: <code>1</code> — одно ядро (vCPU), <code>500m</code> — половина, <code>250m</code> — четверть. Память: <code>Mi</code>, <code>Gi</code> — двоичные (1 Mi = 1 048 576 байт), <code>M</code>, <code>G</code> — десятичные. Опасная опечатка — <code>memory: 512m</code>: суффикс <code>m</code> означает «милли», то есть полбайта, а не 512 мегабайт.</p>
<p>Следствия, о которых спрашивают:</p>
<ul>
<li>Если указан только limit, request по умолчанию приравнивается к нему.</li>
<li>Если не указаны ни requests, ни limits, планировщик считает под бесплатным и может набить узел такими подами, пока тот не начнёт задыхаться. Администраторы ставят <code>LimitRange</code> с умолчаниями для namespace и <code>ResourceQuota</code> на сумму.</li>
<li>Requests, завышенные «на всякий случай», — это деньги: узлы заняты зарезервированной, но неиспользуемой ёмкостью. Заниженные — это шумные соседи и вытеснения. Правильные значения берутся из метрик реального потребления (перцентили за неделю), а не из головы.</li>
<li>Процентная утилизация в HPA считается <strong>от requests</strong>, поэтому без requests HPA по CPU не работает.</li>
</ul>

<h3>QoS-классы и вытеснение</h3>
<p>По соотношению requests и limits каждый под получает <strong>класс качества обслуживания</strong>:</p>
<table>
<thead><tr><th>Класс</th><th>Условие</th><th>Поведение при нехватке памяти узла</th></tr></thead>
<tbody>
<tr><td><strong>Guaranteed</strong></td><td>У каждого контейнера заданы CPU и memory, и requests равны limits</td><td>Вытесняется последним</td></tr>
<tr><td><strong>Burstable</strong></td><td>Хотя бы у одного контейнера задан request или limit, но условие Guaranteed не выполнено</td><td>Вытесняется, если потребляет больше своих requests</td></tr>
<tr><td><strong>BestEffort</strong></td><td>Ни requests, ни limits</td><td>Вытесняется первым</td></tr>
</tbody>
</table>
<p>Важно различать два механизма. <strong>OOMKilled</strong> — это ядро, сработавшее на лимите конкретного контейнера: процесс превысил свой <code>memory.max</code>. <strong>Eviction</strong> — это kubelet, который видит, что узлу в целом не хватает памяти (или диска, или pid-ов), и удаляет поды целиком, чтобы спасти узел; у такого пода статус <code>Evicted</code> с причиной вроде «The node was low on resource: memory». Порядок вытеснения учитывает QoS и то, насколько под превышает свои requests. Если же память узла кончится раньше, чем kubelet успеет вытеснить, сработает системный OOM killer ядра, который тоже учитывает QoS при выборе жертвы.</p>
<p>Отсюда практическое правило для памяти: <strong>memory request = memory limit</strong>. Память несжимаема: её нельзя «отобрать» у процесса без его убийства. Если request меньше limit, планировщик может разместить на узле подов на сумму requests, а потребить они вправе на сумму limits; в пиковый момент узлу не хватит памяти, и начнутся вытеснения, причём жертвой станет тот, кто превысил request, даже если он не превысил свой limit.</p>

<h3>CPU throttling: как работает CFS-квота</h3>
<p>CPU limit реализуется через CFS bandwidth control: ядро выдаёт группе квоту процессорного времени на каждый период, обычно 100 мс. Limit <code>2</code> означает 200 мс процессорного времени на период <strong>суммарно по всем потокам</strong>. Когда квота кончилась, все потоки группы стоят до начала следующего периода.</p>
<p>Почему это бьёт по латентности многопоточных приложений, а .NET-сервис как раз такой. Пусть limit — 2 CPU, а на узле 16 ядер. Пришёл всплеск запросов, и 8 потоков одновременно работают на 8 ядрах. Квота 200 мс исчерпана за 25 мс реального времени, после чего процесс <strong>простаивает 75 мс</strong>. Запрос, который должен был выполниться за 30 мс, выполняется за 105. При этом средняя загрузка CPU в метриках может быть 30% от лимита: усреднение за минуту скрывает всплески внутри 100-миллисекундных окон. К тому же Server GC запускает сборку на нескольких потоках одновременно, и пауза GC тоже съедает квоту рывком.</p>
<p>Как увидеть: метрики cAdvisor <code>container_cpu_cfs_throttled_periods_total</code> и <code>container_cpu_cfs_periods_total</code>. Их отношение — доля периодов, в которых контейнер троттлился:</p>
<pre><code>rate(container_cpu_cfs_throttled_periods_total{container="api"}[5m])
/
rate(container_cpu_cfs_periods_total{container="api"}[5m])</code></pre>
<p>Если доля заметная (десятки процентов), а p99 латентности растёт без видимой загрузки — это оно.</p>

<h3>Ставить ли CPU limit</h3>
<p>Вопрос спорный, и на собеседовании ценится взвешенный ответ, а не лозунг.</p>
<p><strong>Аргументы против CPU limits</strong> для сервисов, чувствительных к латентности: троттлинг даёт хвосты латентности даже при низкой средней загрузке; свободный процессор узла простаивает, хотя мог бы ускорить всплеск; защиту от соседей и так даёт CPU request, который превращается в вес — при конкуренции каждый получит свою долю. CPU, в отличие от памяти, сжимаем: переедание соседа замедляет, но не убивает.</p>
<p><strong>Аргументы за</strong>: предсказуемость (сервис ведёт себя одинаково на пустом и на загруженном узле, а нагрузочный тест на пустом кластере не обманывает); защита от бага с бесконечным циклом; мультиарендные кластеры и учёт затрат; требования политик (Guaranteed QoS требует limits, равных requests); некоторые администраторы обязывают их через LimitRange.</p>
<p><strong>Специфика .NET</strong>, которую стоит упомянуть: без CPU limit <code>Environment.ProcessorCount</code> равен числу ядер узла. Это значит большой минимум пула потоков и, до .NET 9 с DATAS, десятки куч Server GC и раздутая память. Поэтому, убирая CPU limit, разумно задать <code>DOTNET_PROCESSOR_COUNT</code> примерно по request (или чуть выше), чтобы рантайм не настраивался под 64 ядра, которых ему никто не обещал.</p>
<p>Компромиссная позиция, которую часто принимают: точные requests по метрикам для всех; memory limit равен request; CPU limit либо не ставится для latency-критичных API, либо ставится с запасом (в 2–4 раза выше request) и с мониторингом троттлинга.</p>

<h3>Horizontal Pod Autoscaler</h3>
<p><strong>HPA</strong> меняет число реплик Deployment (или StatefulSet) по метрикам. Контроллер раз в 15 секунд (по умолчанию) считает:</p>
<p><code>desiredReplicas = ceil(currentReplicas × currentMetric / targetMetric)</code></p>
<p>и не реагирует на отклонения в пределах допуска (около 10%).</p>
<pre><code>apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: polestar-api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: polestar-api
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300</code></pre>
<p>Типы метрик в <code>autoscaling/v2</code>:</p>
<ul>
<li><strong>Resource</strong> — CPU или память, из metrics-server, в процентах от requests или в абсолютных значениях;</li>
<li><strong>Pods</strong> — метрика, усреднённая по подам: запросы в секунду на под, число активных соединений. Источник — адаптер custom metrics API, например Prometheus Adapter;</li>
<li><strong>Object</strong> — метрика другого объекта кластера, например RPS на Ingress;</li>
<li><strong>External</strong> — метрика извне кластера: длина очереди, лаг консьюмер-группы.</li>
</ul>
<p>Практические замечания:</p>
<ul>
<li><strong>Масштабирование по памяти для .NET почти никогда не работает.</strong> GC не обязан возвращать память ОС после спада нагрузки, рабочий набор остаётся высоким, и HPA никогда не уменьшит число реплик. Масштабируйте по CPU, RPS или лагу.</li>
<li><code>behavior</code> управляет скоростью: по умолчанию масштабирование вверх мгновенное, а вниз — с окном стабилизации 5 минут, чтобы не «дёргаться». Можно ограничить шаг (не больше N подов или процентов за период).</li>
<li>HPA реагирует с запаздыванием: сбор метрик, расчёт, старт пода, прогрев, readiness. Для сервиса с медленным стартом ставьте запас по <code>minReplicas</code> и целевую утилизацию пониже.</li>
<li>Если Deployment управляется через GitOps, не указывайте в манифесте <code>replicas</code> — иначе каждая синхронизация будет возвращать число реплик к значению из Git, споря с HPA.</li>
<li>Новые поды должны куда-то поместиться. Если ёмкости узлов не хватает, поды висят в Pending, пока <strong>Cluster Autoscaler</strong> (или Karpenter) не добавит узел, — это ещё минуты.</li>
</ul>

<h3>VPA и KEDA</h3>
<p><strong>Vertical Pod Autoscaler</strong> подбирает requests и limits по истории потребления. Компоненты: recommender считает рекомендации, updater пересоздаёт поды с новыми значениями, admission controller подставляет их при создании. Режимы: <code>Off</code> (только рекомендации — самый популярный способ использования: смотреть, сколько на самом деле нужно), <code>Initial</code> (применять только при создании пода), <code>Recreate</code>/<code>Auto</code> (пересоздавать поды). Ограничения: применение через пересоздание означает рестарты подов, а HPA и VPA нельзя натравливать на одну и ту же метрику CPU или памяти — они будут бороться. В Kubernetes появилась возможность менять ресурсы работающего пода без пересоздания (in-place pod resize: бета и включено по умолчанию с 1.33, стабильно с 1.35), и у VPA для неё есть режим <code>InPlaceOrRecreate</code>.</p>
<p><strong>KEDA</strong> (Kubernetes Event-Driven Autoscaling) — оператор, масштабирующий по событиям из внешних источников: лаг Kafka, длина очереди RabbitMQ, Redis, SQL-запрос, Prometheus-запрос, расписание. Он создаёт и настраивает HPA сам и умеет то, чего HPA не умеет: <strong>масштабирование до нуля</strong> и обратно при появлении событий.</p>
<pre><code>apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: orders-consumer
spec:
  scaleTargetRef:
    name: orders-consumer
  minReplicaCount: 1
  maxReplicaCount: 12
  cooldownPeriod: 300
  triggers:
    - type: kafka
      metadata:
        bootstrapServers: kafka:9092
        consumerGroup: orders-consumer
        topic: orders
        lagThreshold: "500"</code></pre>
<p>Для консьюмеров Kafka важно помнить:</p>
<ul>
<li>Реплик больше, чем партиций в топике, бесполезно: лишние консьюмеры группы простаивают без партиций. Kafka-скейлер KEDA по умолчанию не поднимает реплик больше, чем партиций.</li>
<li>Каждое изменение числа реплик — ребалансировка группы, во время которой обработка (частично или полностью, в зависимости от стратегии назначения) останавливается. Частое «дыхание» реплик хуже, чем чуть завышенный минимум. Окна стабилизации здесь важнее, чем для HTTP-сервиса. Учтите: <code>cooldownPeriod</code> KEDA действует только на переход к нулю реплик (в примере выше с <code>minReplicaCount: 1</code> он ни на что не влияет), а шаги между 1 и N делает HPA — их скорость задают в <code>advanced.horizontalPodAutoscalerConfig.behavior</code>.</li>
<li>Консьюмер должен корректно завершаться: на SIGTERM дочитать текущее, закоммитить offset, закрыть consumer, иначе каждое масштабирование вниз даёт повторную обработку и таймаут сессии.</li>
</ul>

<h3>Размещение: anti-affinity и topology spread</h3>
<p>Три реплики на одном узле — это одна реплика с точки зрения отказоустойчивости. Планировщик по умолчанию старается распределять поды, но ничего не гарантирует. Инструменты:</p>
<p><strong>Pod anti-affinity</strong> — «не ставь меня рядом с подами с такими метками» в пределах топологического домена (узел, зона):</p>
<pre><code>affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          topologyKey: kubernetes.io/hostname
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: polestar-api</code></pre>
<p>Вариант <code>required…</code> — жёсткое правило: если подходящего узла нет, под останется в Pending. С ним реплик не может быть больше, чем узлов, и rolling update с <code>maxSurge</code> может застрять.</p>
<p><strong>Topology spread constraints</strong> — более гибкий и рекомендуемый механизм: «разница в числе подов между доменами не больше <code>maxSkew</code>»:</p>
<pre><code>topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app.kubernetes.io/name: polestar-api
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app.kubernetes.io/name: polestar-api</code></pre>
<p><code>DoNotSchedule</code> — жёсткое правило, <code>ScheduleAnyway</code> — мягкое предпочтение. Распределение по зонам защищает от отказа зоны доступности, по узлам — от отказа узла. Учтите, что правила применяются в момент планирования: если узел пропал и поды пересоздались неравномерно, сами они обратно не перераспределятся (для этого есть descheduler).</p>
<p>Связанные понятия: <strong>nodeSelector</strong> и <strong>node affinity</strong> — «ставь только на узлы с метками» (например, с GPU или в определённой зоне); <strong>taints и tolerations</strong> — узел отталкивает все поды, кроме тех, что явно это терпят (выделенные узлы для баз или системных компонентов); <strong>PriorityClass</strong> — какие поды при нехватке места могут вытеснить другие.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Чем requests отличаются от limits?»</summary>
<p>Requests — гарантированный объём, по нему планировщик выбирает узел: сумма requests на узле не превышает его allocatable, а фактическое потребление не учитывается. CPU request дополнительно становится весом cgroup и даёт пропорциональную долю при конкуренции. Limits — потолок, который обеспечивает ядро: при превышении CPU limit процесс троттлится, при превышении memory limit — убивается с OOMKilled. Если задан только limit, request равен ему. Утилизация в HPA считается от requests. От соотношения requests и limits зависит QoS-класс пода.</p>
</details>
<details><summary>«Что такое QoS-классы и на что они влияют?»</summary>
<p>Guaranteed — у всех контейнеров заданы CPU и память, requests равны limits; Burstable — что-то задано, но не всё равно; BestEffort — ничего не задано. Класс влияет на порядок вытеснения kubelet-ом при нехватке ресурсов узла: сначала BestEffort, затем Burstable, превышающие свои requests, Guaranteed — последними. Он же влияет на выбор жертвы системным OOM killer. Для продакшен-сервисов разумно хотя бы задавать requests и memory limit, равный memory request, чтобы под не стал первым кандидатом на вытеснение.</p>
</details>
<details><summary>«Почему CPU limit может ухудшить латентность, даже если средняя загрузка низкая?»</summary>
<p>CPU limit реализован как CFS-квота: определённое процессорное время на период 100 мс суммарно по всем потокам. Многопоточный процесс в всплеске выбирает квоту за доли периода и остаток периода простаивает. Например, limit 2 и 8 активных потоков: квота кончается за 25 мс, затем 75 мс простоя, и запрос получает лишние 75 мс. Средняя загрузка за минуту при этом низкая — всплески внутри окон усредняются. Диагностика — доля троттлированных периодов по метрикам cAdvisor. Решения — поднять limit, убрать его для latency-критичных сервисов, оставив точный request, и для .NET в этом случае задать <code>DOTNET_PROCESSOR_COUNT</code>.</p>
</details>
<details><summary>«Чем OOMKilled отличается от Evicted?»</summary>
<p>OOMKilled — ядро убило конкретный контейнер, превысивший свой memory limit; контейнер перезапускается в том же поде, растёт счётчик рестартов, код выхода 137. Evicted — kubelet удалил под целиком, потому что узлу в целом не хватает памяти, диска или pid-ов; под не перезапускается на месте, контроллер создаёт новый на другом узле. Первое лечится лимитом или потреблением приложения, второе — правильными requests (особенно memory request равным limit), чтобы на узел не планировалось больше, чем он вмещает, и контролем ephemeral storage.</p>
</details>
<details><summary>«Как работает HPA и почему не стоит масштабировать .NET-сервис по памяти?»</summary>
<p>HPA периодически считает желаемое число реплик как <code>ceil(текущие × текущая метрика / целевая)</code> и меняет <code>replicas</code> у Deployment в пределах min и max. Метрики — CPU и память от metrics-server в процентах от requests, кастомные метрики подов через адаптер, метрики объектов и внешние. Скорость регулирует <code>behavior</code>: вверх по умолчанию быстро, вниз — с окном стабилизации пять минут. Память .NET-процесса после спада нагрузки не обязана уменьшаться — GC не возвращает её ОС сразу, — поэтому HPA по памяти масштабирует вверх и почти никогда вниз. Лучше CPU, RPS на под или длина очереди.</p>
</details>
<details><summary>«Как масштабировать консьюмер Kafka?»</summary>
<p>По лагу консьюмер-группы, а не по CPU: консьюмер может ждать I/O при низком CPU, а лаг растёт. Стандартный инструмент — KEDA со скейлером Kafka: <code>lagThreshold</code> на реплику, минимальное и максимальное число реплик, возможность масштабирования до нуля. Максимум ограничен числом партиций — лишние консьюмеры простаивают, и KEDA по умолчанию столько не поднимает. Каждое изменение числа реплик — ребалансировка, поэтому нужны окна стабилизации (<code>cooldownPeriod</code> влияет только на переход к нулю), кооперативная стратегия назначения партиций и корректное завершение консьюмера: дочитать, закоммитить offset, закрыть.</p>
</details>
<details><summary>«Как гарантировать, что реплики не окажутся на одном узле или в одной зоне?»</summary>
<p>Через topology spread constraints: <code>maxSkew</code>, <code>topologyKey</code> (<code>kubernetes.io/hostname</code> для узлов, <code>topology.kubernetes.io/zone</code> для зон) и <code>whenUnsatisfiable</code> — жёстко или мягко. Альтернатива — pod anti-affinity, но жёсткий вариант ограничивает число реплик числом узлов и может заблокировать rolling update. Мягкие правила обычно предпочтительнее: лучше неравномерное размещение, чем поды в Pending. Дополнительно — PodDisruptionBudget, чтобы обслуживание узлов не сняло все реплики сразу. Правила действуют только при планировании, поэтому после аварии распределение может остаться неравномерным.</p>
</details>
<details><summary>«Что не так с memory: 512m?»</summary>
<p>Суффикс <code>m</code> означает «милли», поэтому это 0,512 байта, а не 512 мегабайт. API примет значение, но контейнер не сможет запуститься или будет немедленно убит. Нужно <code>512Mi</code> (мебибайты) или <code>512M</code> (мегабайты). Для CPU <code>m</code> как раз правильный суффикс — миллиядра, <code>500m</code> — половина ядра. Такие ошибки ловят валидацией манифестов в CI: kubeconform, политики Kyverno или OPA Gatekeeper.</p>
</details>
`
    },
    {
      id: 'config',
      title: 'Конфигурация и секреты',
      html: `
<h3>Один образ — много окружений</h3>
<p>Базовый принцип: образ собирается <strong>один раз</strong> и без изменений проходит dev, staging и production; различается только конфигурация, которую подставляет среда. Если в образ «зашит» адрес базы или <code>appsettings.Production.json</code> с паролем, то, во-первых, на стейджинге проверяли не тот артефакт, что ушёл в продакшен, а во-вторых, секрет лежит в registry, в каждом кэше и у каждого, кто может сделать <code>docker pull</code>.</p>
<p>Способов передать конфигурацию в контейнер три:</p>
<ul>
<li><strong>Переменные окружения</strong> — проще всего, поддерживаются всеми инструментами, ASP.NET Core читает их из коробки. Минусы: значения видны в <code>docker inspect</code>, в <code>/proc/&lt;pid&gt;/environ</code>, наследуются дочерними процессами, иногда попадают в логи и отчёты об ошибках; обновляются только перезапуском процесса; неудобны для многострочных значений вроде сертификатов.</li>
<li><strong>Смонтированные файлы</strong> — ConfigMap или Secret как том. Подходят для сертификатов, JSON-конфигурации, ключей. В Kubernetes Secret-тома живут в памяти (tmpfs) и не пишутся на диск узла. Могут обновляться без перезапуска пода.</li>
<li><strong>Аргументы командной строки</strong> — <code>args</code> в спецификации контейнера. Для пары флагов; секреты так не передают — они видны в списке процессов.</li>
</ul>
<p>Что считать секретом: пароли и строки подключения, токены API, client secret OIDC-клиента, ключи шифрования и подписи (например, VAPID-ключи для push), приватные ключи сертификатов, ключи доступа к S3. Что не секрет: адреса сервисов, таймауты, уровни логирования, флаги функций.</p>

<h3>ConfigMap: переменные и тома</h3>
<pre><code>apiVersion: v1
kind: ConfigMap
metadata:
  name: polestar-api
data:
  ASPNETCORE_ENVIRONMENT: Production
  Keycloak__Authority: https://sso.example.com/realms/polestar
  Logging__LogLevel__Default: Information
  appsettings.Kubernetes.json: |
    {
      "Media": { "PresignedUrlLifetime": "00:05:00" }
    }</code></pre>
<p>Использование в поде:</p>
<pre><code>containers:
  - name: api
    envFrom:
      - configMapRef:
          name: polestar-api        # все ключи как переменные
    env:
      - name: ConnectionStrings__Default
        valueFrom:
          secretKeyRef:
            name: polestar-db
            key: connection-string
    volumeMounts:
      - name: config
        mountPath: /app/config
        readOnly: true
volumes:
  - name: config
    configMap:
      name: polestar-api
      items:
        - key: appsettings.Kubernetes.json
          path: appsettings.Kubernetes.json</code></pre>
<p>Детали, которые стоит знать:</p>
<ul>
<li><code>envFrom</code> берёт все ключи, а ключи, недопустимые как имена переменных, пропускает (с событием). <code>env</code> с <code>valueFrom</code> берёт конкретный ключ.</li>
<li>Если ConfigMap или ключ, на которые ссылается под, не существует, контейнер не стартует: <code>CreateContainerConfigError</code>. Для необязательных ссылок есть <code>optional: true</code>.</li>
<li>Размер ConfigMap ограничен примерно мегабайтом (ограничение объекта в etcd) — это не место для больших файлов.</li>
<li><code>immutable: true</code> делает ConfigMap или Secret неизменяемым: kubelet перестаёт следить за ним (меньше нагрузки на API-сервер в больших кластерах), и случайное изменение невозможно — новая версия создаётся под новым именем.</li>
</ul>

<h3>Конфигурация ASP.NET Core в Kubernetes</h3>
<p><code>WebApplication.CreateBuilder</code> собирает конфигурацию из источников в таком порядке, где каждый следующий перекрывает предыдущие:</p>
<ol>
<li><code>appsettings.json</code>;</li>
<li><code>appsettings.{Environment}.json</code>;</li>
<li>user secrets (только в Development);</li>
<li>переменные окружения;</li>
<li>аргументы командной строки.</li>
</ol>
<p>Иерархия ключей в переменных окружения выражается двойным подчёркиванием: <code>Kafka__Consumer__GroupId</code> — это <code>Kafka:Consumer:GroupId</code>, а элементы массива — индексами: <code>AllowedOrigins__0</code>. Переменные с префиксами <code>DOTNET_</code> и <code>ASPNETCORE_</code> дополнительно используются для настройки самого хоста (окружение, адреса, порты).</p>
<p>Секреты-файлы удобно читать провайдером <strong>Key-per-file</strong> (<code>Microsoft.Extensions.Configuration.KeyPerFile</code>): имя файла — ключ, содержимое — значение, двойное подчёркивание в имени файла — разделитель секций:</p>
<pre><code>builder.Configuration.AddKeyPerFile(
    directoryPath: "/run/secrets/polestar",
    optional: true);</code></pre>
<p>Тогда Secret с ключом <code>ConnectionStrings__Default</code>, смонтированный в <code>/run/secrets/polestar</code>, становится <code>ConnectionStrings:Default</code> — так же, как была бы переменная окружения, но без её недостатков. Целый JSON-файл из ConfigMap подключается обычным <code>AddJsonFile("config/appsettings.Kubernetes.json", optional: true, reloadOnChange: true)</code>.</p>
<p>Хорошая практика — <strong>проверять конфигурацию при старте</strong>: <code>services.AddOptions&lt;KafkaOptions&gt;().Bind(...).ValidateDataAnnotations().ValidateOnStart()</code>. Тогда под с опечаткой в имени переменной падает сразу при деплое и rolling update останавливается, а не работает до первого запроса, который упадёт через час.</p>

<h3>Обновление конфигурации: что меняется само, а что нет</h3>
<p>Здесь много неочевидного, и это частый вопрос.</p>
<ul>
<li><strong>Переменные окружения не обновляются никогда.</strong> Они задаются при старте контейнера. Изменили ConfigMap — работающие поды продолжат жить со старыми значениями до перезапуска.</li>
<li><strong>Тома ConfigMap и Secret обновляются</strong> — kubelet периодически синхронизирует их, и изменения доходят до файлов с задержкой (порядка минуты: период синхронизации kubelet плюс кэш). Файлы заменяются атомарно через переключение символической ссылки <code>..data</code>.</li>
<li><strong>Тома, смонтированные через <code>subPath</code>, не обновляются никогда.</strong> Если вы смонтировали один файл поверх существующего каталога через <code>subPath</code>, он останется таким, каким был при старте.</li>
<li>Даже если файл обновился, приложение должно его <strong>перечитать</strong>. <code>reloadOnChange: true</code> полагается на отслеживание файловой системы, а атомарная подмена через символическую ссылку отслеживается ненадёжно — изменение может остаться незамеченным. Обходной путь — режим опроса (переменная <code>DOTNET_USE_POLLING_FILE_WATCHER=true</code>), но многие команды предпочитают вообще не полагаться на горячую перезагрузку.</li>
<li>И даже перечитанная конфигурация дойдёт только до кода, который читает её через <code>IOptionsMonitor&lt;T&gt;</code> (или <code>IOptionsSnapshot&lt;T&gt;</code> в рамках запроса). <code>IOptions&lt;T&gt;</code> — это значение, вычисленное один раз. Объекты, которые построены из конфигурации при старте (клиент Kafka, пул соединений), сами не перестроятся.</li>
</ul>
<p>Поэтому самый надёжный способ применить новую конфигурацию — <strong>пересоздать поды rolling update-ом</strong>. Чтобы это происходило автоматически при изменении ConfigMap, в шаблон пода кладут аннотацию с хэшем конфигурации: в Helm это классический приём <code>checksum/config</code> с хэшем шаблона ConfigMap. Изменился ConfigMap — изменился хэш — изменился шаблон — Deployment выкатывает новые поды с проверкой готовности и возможностью отката. Есть и операторы вроде Reloader, которые делают то же по аннотации. Плюс такого подхода: изменение конфигурации проходит тот же путь, что изменение кода, и плохая конфигурация останавливает выкатку на первом же поде, а не ломает все поды разом.</p>

<h3>Secret — это base64, а не шифрование</h3>
<pre><code>apiVersion: v1
kind: Secret
metadata:
  name: polestar-db
type: Opaque
stringData:
  connection-string: "Host=pg;Database=polestar;Username=app;Password=..."</code></pre>
<p>В поле <code>data</code> значения хранятся в base64 (в <code>stringData</code> можно писать открытым текстом — API-сервер закодирует сам). Base64 — это кодирование, а не шифрование: <code>kubectl get secret polestar-db -o jsonpath='{.data.connection-string}' | base64 -d</code> показывает пароль любому, у кого есть право на чтение секретов.</p>
<p>Чем же Secret лучше ConfigMap?</p>
<ul>
<li>Отдельный тип ресурса — можно дать право читать ConfigMap и не дать читать Secret через RBAC.</li>
<li>Тома секретов монтируются в tmpfs и не пишутся на диск узла; на узел секрет передаётся только если там есть под, который его использует.</li>
<li>Инструменты знают, что это секрет: <code>kubectl describe</code> не показывает значения, некоторые системы маскируют их в логах.</li>
<li>Можно включить шифрование в etcd.</li>
</ul>
<p>Чего Secret не даёт по умолчанию:</p>
<ul>
<li><strong>Шифрования при хранении.</strong> В etcd секреты лежат в открытом виде, если администратор не настроил <code>EncryptionConfiguration</code> (провайдеры <code>aescbc</code>, <code>secretbox</code>, лучше всего <code>kms</code> с внешним ключом). Управляемые кластеры часто шифруют диски etcd или предлагают KMS-интеграцию, но это стоит проверить, а не предполагать.</li>
<li><strong>Защиты от тех, кто может создавать поды.</strong> Любой, кто вправе создать под в namespace, может смонтировать в него любой секрет этого namespace и прочитать. Поэтому право <code>create pods</code> по сути включает право читать секреты.</li>
<li><strong>Безопасного хранения в Git.</strong> Манифест Secret в репозитории — это пароль в репозитории, base64 не спасает.</li>
<li><strong>Ротации и аудита</strong> на уровне значения: кто и когда поменял пароль, автоматическая смена — это задача внешних хранилищ.</li>
</ul>

<h3>Внешние хранилища секретов</h3>
<p>В зрелых компаниях источник истины для секретов — отдельная система: HashiCorp Vault (или его форк OpenBao), облачные менеджеры секретов (AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, Yandex Lockbox). Варианты доставки в под:</p>
<ul>
<li><strong>External Secrets Operator (ESO)</strong>. Вы описываете <code>SecretStore</code> (как подключиться к хранилищу) и <code>ExternalSecret</code> (какие ключи забрать), а оператор периодически синхронизирует их в обычный Kubernetes Secret. Приложение ничего не знает о Vault: читает переменную или файл. В Git лежит только ссылка на секрет, а не значение.</li>
<li><strong>Vault Agent Injector</strong>. Mutating webhook добавляет в под sidecar (или init container) с агентом Vault, который аутентифицируется по ServiceAccount пода, забирает секреты и пишет их в общий том, а при необходимости продлевает и обновляет. Секрет не попадает в etcd как объект Kubernetes.</li>
<li><strong>Secrets Store CSI Driver</strong>. Секреты монтируются как том прямо из хранилища через CSI-драйвер, с опциональной синхронизацией в Kubernetes Secret.</li>
<li>Для GitOps без внешнего хранилища — <strong>Sealed Secrets</strong> (в Git лежит зашифрованный публичным ключом кластера объект, расшифровать его может только контроллер в кластере) или <strong>SOPS</strong> (шифрование значений в YAML ключами KMS или age, расшифровка при деплое).</li>
</ul>
<pre><code># версия API зависит от версии оператора
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: polestar-db
spec:
  refreshInterval: 1h
  secretStoreRef:
    kind: ClusterSecretStore
    name: vault
  target:
    name: polestar-db
  data:
    - secretKey: connection-string
      remoteRef:
        key: polestar/production/db
        property: connection-string</code></pre>
<p>Vault умеет выдавать <strong>динамические секреты</strong>: для каждого клиента создаётся отдельный пользователь PostgreSQL с ограниченным сроком жизни, и утёкший пароль через час перестаёт работать. Цена — приложение должно переживать смену учётных данных: пересоздавать пул соединений, перечитывать строку подключения. В .NET это решается через <code>IOptionsMonitor</code> и фабрику источника данных Npgsql, которая берёт актуальный пароль; в простых случаях — перезапуском пода до истечения срока.</p>
<p>Ещё лучше секрета — его отсутствие: <strong>workload identity</strong>. Под аутентифицируется во внешнем сервисе (облачное хранилище, база с IAM-аутентификацией, Vault) токеном своего ServiceAccount, который Kubernetes выпускает с коротким сроком жизни, и долгоживущих паролей нет вовсе.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Переменные окружения или смонтированные файлы — что лучше для секретов?»</summary>
<p>Файлы, как правило, лучше. Переменные видны в <code>docker inspect</code> и <code>/proc/&lt;pid&gt;/environ</code>, наследуются дочерними процессами, их легко случайно залогировать вместе с окружением при ошибке, и они меняются только перезапуском. Тома секретов в Kubernetes лежат в tmpfs, могут обновляться без перезапуска пода, удобны для сертификатов и многострочных значений. ASP.NET Core читает их провайдером key-per-file, где имя файла — ключ. При этом переменные окружения — нормальный компромисс для многих команд, если доступ к подам и манифестам ограничен; главное — не держать секреты в образе и в Git.</p>
</details>
<details><summary>«Поменяли ConfigMap — приложение не видит изменения. Почему?»</summary>
<p>Если значения переданы переменными окружения — они фиксируются при старте контейнера и не обновятся до перезапуска. Если томом через <code>subPath</code> — такие тома не обновляются вовсе. Если обычным томом — файл обновится с задержкой около минуты, но приложение должно его перечитать, а отслеживание изменений через подмену символической ссылки ненадёжно. И даже перечитанная конфигурация видна только через <code>IOptionsMonitor</code>, а не <code>IOptions</code>. Надёжное решение — выкатывать новую конфигурацию пересозданием подов: хэш ConfigMap в аннотации шаблона пода (<code>checksum/config</code> в Helm) или <code>kubectl rollout restart</code>.</p>
</details>
<details><summary>«Безопасно ли хранить пароли в Kubernetes Secret?»</summary>
<p>Base64 — это не шифрование, и любой с правом читать секреты или создавать поды в namespace может получить значение. В etcd секреты по умолчанию не зашифрованы, если не настроен <code>EncryptionConfiguration</code>, желательно с KMS. Secret всё же лучше ConfigMap: отдельные права RBAC, tmpfs вместо диска, передача только на узлы, где он нужен. Для серьёзной защиты нужны: строгий RBAC, шифрование etcd, отказ от секретов в Git (ESO, Sealed Secrets, SOPS), внешнее хранилище вроде Vault с аудитом и ротацией, а в идеале — короткоживущие учётные данные или workload identity.</p>
</details>
<details><summary>«Как устроен External Secrets Operator и зачем он нужен?»</summary>
<p>ESO — оператор, который синхронизирует значения из внешнего хранилища (Vault, облачные менеджеры секретов, Yandex Lockbox) в обычные Kubernetes Secret. <code>SecretStore</code> или <code>ClusterSecretStore</code> описывает подключение и аутентификацию, <code>ExternalSecret</code> — какие ключи забрать, в какой Secret положить и как часто обновлять. В Git остаётся только ссылка, источник истины, аудит и ротация — во внешнем хранилище, а приложение работает с обычным Secret и ничего не знает о Vault. Минус — значение всё равно оказывается в etcd как Secret, поэтому шифрование etcd и RBAC по-прежнему важны; альтернатива без этого — Vault Agent Injector или CSI-драйвер.</p>
</details>
<details><summary>«В каком порядке ASP.NET Core читает конфигурацию и как задать вложенный ключ переменной?»</summary>
<p>По умолчанию: <code>appsettings.json</code>, затем <code>appsettings.{Environment}.json</code>, user secrets в Development, переменные окружения и аргументы командной строки; каждый следующий источник перекрывает предыдущий. Вложенность в переменных — двойное подчёркивание (<code>Kafka__Consumer__GroupId</code>), элементы массива — индексом (<code>Hosts__0</code>). Двоеточие в имени переменной работает не во всех средах, поэтому используют подчёркивания. Порядок можно менять и добавлять провайдеры — key-per-file для смонтированных секретов, Vault, Consul. Полезно включать валидацию опций при старте через <code>ValidateOnStart</code>, чтобы ошибка конфигурации ломала деплой, а не первый запрос.</p>
</details>
<details><summary>«Почему не стоит собирать отдельный образ под каждое окружение?»</summary>
<p>Тогда на стейджинге тестируется не тот артефакт, что уходит в продакшен, и любая разница в сборке остаётся непроверенной. Конфигурация и особенно секреты оказываются в образе, а значит в registry, кэшах CI и у всех, кто может его скачать, и для смены пароля нужна пересборка. Правильно — один образ с неизменяемым тегом, который продвигается по окружениям, и конфигурация из среды: переменные, ConfigMap, Secret, внешние хранилища. Это же даёт быстрый откат: предыдущий образ просто разворачивается с текущей конфигурацией.</p>
</details>
`
    },
    {
      id: 'observability',
      title: 'Наблюдаемость и отладка в K8s',
      html: `
<h3>Логи: где они живут и как собираются</h3>
<p>Контейнер пишет в stdout и stderr, container runtime сохраняет поток в файлы на узле (<code>/var/log/pods/&lt;namespace&gt;_&lt;pod&gt;_&lt;uid&gt;/&lt;container&gt;/</code>), а kubelet ротирует их по размеру. <code>kubectl logs</code> читает именно эти файлы через kubelet. Отсюда ограничения:</p>
<ul>
<li>Логи доступны, пока под существует. Удалили под (rolling update, масштабирование вниз, вытеснение) — логи пропали вместе с ним.</li>
<li>Доступны только текущий и <strong>предыдущий</strong> запуск контейнера: <code>kubectl logs pod --previous</code>. Это главный инструмент для CrashLoopBackOff — текущий контейнер ещё не успел ничего написать.</li>
<li>Ротация ограничивает объём: при высоком потоке логов старые строки исчезают за минуты.</li>
</ul>
<p>Полезные флаги: <code>-f</code> (следить), <code>--since=15m</code>, <code>--tail=200</code>, <code>-c api</code> (контейнер в многоконтейнерном поде), <code>-l app.kubernetes.io/name=polestar-api</code> (по метке, со всех подов сразу, с <code>--prefix</code>, чтобы видеть, какой под что написал), <code>deploy/polestar-api</code> (один из подов Deployment). Для удобного просмотра нескольких подов есть утилиты stern и k9s.</p>
<p>Для долговременного хранения и поиска на каждом узле работает агент (DaemonSet: Fluent Bit, Vector, OpenTelemetry Collector, Grafana Alloy), который читает файлы логов, обогащает записи метаданными Kubernetes (namespace, под, контейнер, метки, узел) и отправляет в хранилище: Loki, Elasticsearch/OpenSearch, ClickHouse. Именно поэтому важен JSON в одну строку: агент без парсинга многострочного текста разбивает стектрейс на отдельные «события», а из JSON сразу извлекает уровень, TraceId и поля.</p>
<p>Помните про объём: логирование каждого запроса на уровне Information в нагруженном сервисе — это и стоимость хранения, и нагрузка на узел, и потерянные строки при ротации. Пробы здоровья и метрики из логов запросов лучше исключать.</p>

<h3>Метрики: Prometheus в Kubernetes</h3>
<p>Prometheus работает по модели <strong>pull</strong>: сам периодически опрашивает (scrape) HTTP-эндпоинты целей, обычно <code>/metrics</code>, и сохраняет временные ряды. В Kubernetes цели находятся через service discovery: Prometheus следит за API-сервером и видит поды, сервисы и эндпоинты с их метками.</p>
<p>В большинстве кластеров Prometheus установлен через <strong>Prometheus Operator</strong> (часто в составе kube-prometheus-stack), и цели описываются не конфигом Prometheus, а объектами CRD:</p>
<pre><code>apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: polestar-api
  labels:
    release: kube-prometheus-stack
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: polestar-api
  endpoints:
    - port: http
      path: /metrics
      interval: 30s</code></pre>
<p>Типичные причины «метрик нет», которые надо уметь назвать:</p>
<ul>
<li>сам ServiceMonitor не подхвачен: у Prometheus настроен селектор (<code>serviceMonitorSelector</code>), и без нужной метки — часто <code>release: …</code> — объект игнорируется; либо Prometheus не смотрит в этот namespace;</li>
<li><code>selector</code> ServiceMonitor выбирает <strong>Service</strong>, а не поды, по меткам самого Service;</li>
<li><code>port</code> — это <strong>имя</strong> порта в Service, а не номер; у порта нет имени — цель не найдётся;</li>
<li>эндпоинт <code>/metrics</code> закрыт аутентификацией или слушает другой порт.</li>
</ul>
<p>Для подов без Service есть <code>PodMonitor</code>. Аннотации вида <code>prometheus.io/scrape: "true"</code> — это соглашение, работающее только если в конфигурации Prometheus есть соответствующие правила; оператор их сам по себе не понимает.</p>
<p>Источники метрик в кластере: <strong>cAdvisor</strong> в kubelet (потребление CPU и памяти контейнерами, троттлинг — <code>container_*</code>), <strong>kube-state-metrics</strong> (состояние объектов: рестарты, готовность, желаемые и фактические реплики — <code>kube_*</code>), <strong>node-exporter</strong> (узлы) и метрики самих приложений.</p>
<p>В .NET метрики приложения публикуются через <code>System.Diagnostics.Metrics</code>. С .NET 8 ASP.NET Core сам публикует метрики HTTP-сервера (например, <code>http.server.request.duration</code>), Kestrel и других компонентов; в .NET 9 встроенными стали и метрики рантайма. Наружу их выдают через экспортёр OpenTelemetry (Prometheus-эндпоинт или OTLP в коллектор) или через библиотеку prometheus-net (<code>app.UseHttpMetrics()</code>, <code>app.MapMetrics()</code>). Не забывайте о кардинальности: метка с идентификатором пользователя или полным URL с параметрами создаёт миллионы рядов и кладёт Prometheus. Используйте шаблон маршрута, а не путь.</p>

<h3>OpenTelemetry Collector</h3>
<p>OpenTelemetry — стандарт и набор SDK для трёх сигналов: трейсов, метрик и логов, с общим протоколом <strong>OTLP</strong>. Приложение не обязано знать, куда в итоге уходят данные: оно отправляет OTLP в <strong>Collector</strong>, а тот принимает, обрабатывает (батчинг, сэмплирование, фильтрация, обогащение атрибутами Kubernetes, удаление чувствительных полей) и экспортирует в бэкенды: Jaeger или Tempo для трейсов, Prometheus или VictoriaMetrics для метрик, Loki или Elasticsearch для логов. Смена бэкенда — это изменение конфигурации коллектора, а не кода сервисов.</p>
<p>Варианты развёртывания:</p>
<ul>
<li><strong>Agent</strong> — DaemonSet, по коллектору на узел. Приложения шлют на локальный узел, коллектор добавляет атрибуты узла и пода и может заодно собирать файлы логов.</li>
<li><strong>Gateway</strong> — Deployment, централизованный пул коллекторов. Здесь удобно делать tail-based sampling (решать, сохранять ли трейс, увидев его целиком — например, оставлять все ошибочные и медленные).</li>
<li><strong>Sidecar</strong> — коллектор в каждом поде; удобно для изоляции, но дорого.</li>
</ul>
<p>Типичная схема — агенты на узлах плюс шлюз. Подключение в .NET:</p>
<pre><code>builder.Services.AddOpenTelemetry()
    .ConfigureResource(r =&gt; r.AddService("polestar-api"))
    .WithTracing(t =&gt; t
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter())
    .WithMetrics(m =&gt; m
        .AddAspNetCoreInstrumentation()
        .AddRuntimeInstrumentation()
        .AddOtlpExporter());

builder.Logging.AddOpenTelemetry(o =&gt; o.AddOtlpExporter());</code></pre>
<p>Адрес коллектора и атрибуты задаются стандартными переменными окружения, а имя пода — через downward API:</p>
<pre><code>env:
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: http://otel-collector.observability:4317
  - name: POD_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
  - name: OTEL_RESOURCE_ATTRIBUTES
    value: k8s.pod.name=$(POD_NAME),deployment.environment=production</code></pre>
<p>Синтаксис <code>$(POD_NAME)</code> — подстановка Kubernetes ранее объявленной переменной того же контейнера. Трассировка особенно ценна в микросервисах: один запрос пользователя превращается в цепочку HTTP-вызовов, сообщений Kafka и запросов к базе, и только трейс показывает, где именно ушли 800 миллисекунд. Контекст трейса передаётся между сервисами заголовком <code>traceparent</code>, а через Kafka — в заголовках сообщения.</p>

<h3>Диагностика по статусу пода</h3>
<p>Алгоритм почти всегда один: <code>kubectl get pod</code> → <code>kubectl describe pod</code> (смотреть State, Last State, Reason, Exit Code и раздел Events внизу) → <code>kubectl logs --previous</code> → события namespace (<code>kubectl get events --sort-by=.lastTimestamp</code>).</p>
<table>
<thead><tr><th>Статус</th><th>Что означает</th><th>Где искать причину</th></tr></thead>
<tbody>
<tr><td><code>Pending</code></td><td>Под не назначен на узел</td><td>Events: <code>FailedScheduling</code> — Insufficient cpu/memory (по requests!), taints, nodeSelector/affinity, не привязан PVC, жёсткое anti-affinity</td></tr>
<tr><td><code>ContainerCreating</code> долго</td><td>Узел готовит под</td><td>Events: не монтируется том, нет Secret для тома, проблемы CNI, долгий pull большого образа</td></tr>
<tr><td><code>ErrImagePull</code>, <code>ImagePullBackOff</code></td><td>Не скачивается образ</td><td>Опечатка в имени или теге, тег не существует, приватный registry без <code>imagePullSecrets</code> или с истёкшим токеном, лимит частоты, недоступность registry</td></tr>
<tr><td><code>CreateContainerConfigError</code></td><td>Не собирается конфигурация контейнера</td><td>Нет ConfigMap или Secret, нет ключа в нём, <code>runAsNonRoot</code> с образом под root или с нечисловым пользователем</td></tr>
<tr><td><code>CrashLoopBackOff</code></td><td>Контейнер стартует и падает</td><td><code>logs --previous</code>, Exit Code в Last State, события liveness</td></tr>
<tr><td><code>OOMKilled</code></td><td>Убит за превышение memory limit</td><td>Last State: Reason OOMKilled, код 137; метрики памяти</td></tr>
<tr><td><code>Running</code>, READY <code>0/1</code></td><td>Не проходит readiness</td><td>Events: <code>Readiness probe failed</code> с кодом или таймаутом; правильные ли путь и порт</td></tr>
<tr><td><code>Evicted</code></td><td>Вытеснен kubelet-ом</td><td>Сообщение о нехватке памяти или диска узла; ephemeral storage</td></tr>
<tr><td><code>Terminating</code> долго</td><td>Не удаляется</td><td>Длинный grace period, финализаторы, недоступный узел</td></tr>
</tbody>
</table>

<h3>CrashLoopBackOff, OOMKilled, ImagePullBackOff подробнее</h3>
<p><strong>CrashLoopBackOff</strong> — не причина, а симптом: контейнер завершается, kubelet перезапускает его с растущей задержкой. Код выхода в Last State подсказывает направление:</p>
<ul>
<li><strong>1</strong> или <strong>134</strong> — приложение упало само: исключение при старте (нет конфигурации, не подключается к базе, ошибка в DI), необработанное исключение. Ответ в <code>logs --previous</code>.</li>
<li><strong>137</strong> — SIGKILL. Если Reason <code>OOMKilled</code> — память. Если нет — скорее всего, убит после проваленной liveness probe (в событиях <code>Liveness probe failed … will be restarted</code>) или не уложился в grace period.</li>
<li><strong>0</strong> — приложение завершилось «успешно», а у Deployment <code>restartPolicy: Always</code>. Например, <code>Main</code> забыл вызвать <code>app.Run()</code>, или фоновый воркер вышел из цикла, или в контейнере запущен не тот процесс.</li>
<li><strong>139</strong> — segfault в нативном коде; <strong>exec format error</strong> в логах — образ собран под другую архитектуру (arm64 на amd64-узле).</li>
<li>Мгновенное падение без логов вообще — неверная команда: файл не найден, shell form в образе без shell, опечатка в имени DLL.</li>
</ul>
<p>Частая ловушка — liveness probe, которая начинает проверять раньше, чем приложение поднялось: в логах предыдущего запуска нормальный старт и затем остановка по SIGTERM, а в событиях — проваленная liveness. Лечится startup probe.</p>
<p><strong>OOMKilled</strong>: проверить, что лимит соответствует реальному потреблению (метрика <code>container_memory_working_set_bytes</code> за время до падения), сравнить с размером управляемой кучи. Если куча растёт — утечка или неограниченный кэш, нужен дамп. Если растёт память вне кучи — нативные библиотеки или потоки. Если лимит просто мал под нагрузку — поднять. Важно: при OOMKilled процесс убит SIGKILL, поэтому ни логов, ни дампа при падении не будет — диагностировать приходится заранее, по метрикам и дампам, снятым до падения.</p>
<p><strong>ImagePullBackOff</strong>: в <code>describe</code> есть точное сообщение registry. «not found» или «manifest unknown» — нет такого тега или образа, проверить имя и что CI действительно отправил образ. «unauthorized» или «denied» — нет или неверный <code>imagePullSecrets</code>, секрет в другом namespace, истёк токен. «toomanyrequests» — лимит Docker Hub, нужно зеркало. Таймаут — сетевой доступ узлов к registry. Проверить можно с узла через <code>crictl pull</code>.</p>

<h3>exec, port-forward и ephemeral containers</h3>
<p><code>kubectl exec -it pod -- sh</code> запускает процесс внутри работающего контейнера. В chiseled и distroless-образах shell нет, и exec невозможен — это цена минимального образа. <code>kubectl port-forward pod/имя 8080:8080</code> (или <code>svc/имя</code>) прокидывает порт пода на локальную машину через API-сервер — удобно, чтобы обратиться к сервису напрямую, минуя ingress, или открыть внутренний эндпоинт отладки. Port-forward к Service на самом деле выбирает один под и подключается к нему.</p>
<p><strong>Ephemeral containers</strong> — временный контейнер, добавляемый в уже работающий под, с собственным образом с инструментами (стабильная функция с Kubernetes 1.25):</p>
<pre><code>kubectl debug -it pod/polestar-api-7d9f8b-x2k4q \\
  --image=busybox --target=api -- sh</code></pre>
<p>Флаг <code>--target</code> помещает отладочный контейнер в pid-namespace указанного контейнера: видно процессы приложения, а его файловая система доступна через <code>/proc/&lt;pid&gt;/root/</code>. Сеть у контейнеров пода и так общая, поэтому <code>curl localhost:8080</code> из отладочного контейнера достаёт до приложения. Ephemeral container нельзя удалить или перезапустить — он остаётся в спецификации пода, пока жив под; для продакшена на это нужны права, которые обычно есть не у всех.</p>
<p>Другие варианты <code>kubectl debug</code>: копия пода с изменённым образом или командой (<code>--copy-to</code>) — чтобы отладить падающий под, не трогая оригинал; и отладка узла (<code>kubectl debug node/имя</code>) — под с доступом к файловой системе узла.</p>

<h3>dotnet-dump, dotnet-trace и dotnet-counters в поде</h3>
<p>Диагностические инструменты .NET (<code>dotnet-counters</code>, <code>dotnet-trace</code>, <code>dotnet-dump</code>, <code>dotnet-gcdump</code>) подключаются к процессу через <strong>диагностический IPC-сокет</strong>, который рантайм создаёт во временном каталоге (<code>/tmp</code>) своего контейнера. Значит, инструмент должен видеть процесс и этот сокет, а в минимальном продакшен-образе самих инструментов нет. Варианты:</p>
<ul>
<li><strong>Диагностический sidecar с общим /tmp.</strong> В под добавляется том <code>emptyDir</code>, смонтированный в <code>/tmp</code> и приложения, и sidecar-а с инструментами. Тогда инструменты в sidecar видят сокет. Самый удобный вариант — официальный <strong>dotnet-monitor</strong>: он работает как sidecar, приложение подключается к нему через переменную <code>DOTNET_DiagnosticPorts</code>, а dotnet-monitor отдаёт по HTTP дампы, трейсы, gcdump, логи и метрики, и умеет снимать их автоматически по триггерам (например, при росте памяти или CPU выше порога).</li>
<li><strong>Ephemeral container</strong> с образом SDK и <code>--target</code>. Процессы видны, но сокет лежит в <code>/tmp</code> целевого контейнера, то есть в чужой файловой системе, доступной через <code>/proc/&lt;pid&gt;/root/tmp</code>, — поэтому инструментам приходится подсказывать путь, а дамп рантайм запишет в файловую систему приложения. Работает, но требует сноровки и заранее отрепетированной процедуры.</li>
<li><strong>Дамп при падении</strong>: переменные <code>DOTNET_DbgEnableMiniDump=1</code>, <code>DOTNET_DbgMiniDumpType</code> (например, 2 — с кучей) и <code>DOTNET_DbgMiniDumpName</code> с путём на смонтированном томе. Рантайм сам запишет дамп при аварийном завершении. Но <strong>не при OOMKilled</strong>: SIGKILL перехватить нельзя.</li>
</ul>
<p>Что каким инструментом:</p>
<ul>
<li><code>dotnet-counters monitor -p 1</code> — живые счётчики: CPU, размер кучи и число сборок по поколениям, пул потоков (длина очереди, число потоков), исключения в секунду, запросы ASP.NET Core. Первое, что смотрят при «тормозит».</li>
<li><code>dotnet-trace collect -p 1</code> — трейс событий рантайма и семплирование стеков: где тратится CPU, что блокирует потоки. Открывается в PerfView, Visual Studio или как speedscope.</li>
<li><code>dotnet-gcdump collect -p 1</code> — лёгкий снимок управляемой кучи (какие типы сколько занимают), удобен при подозрении на утечку, но вызывает полную сборку мусора.</li>
<li><code>dotnet-dump collect -p 1</code> — полный дамп процесса для анализа <code>dotnet-dump analyze</code> (команды <code>clrstack</code>, <code>dumpheap -stat</code>, <code>gcroot</code>) или в IDE. Дамп большой — размером с память процесса — и на время снятия процесс замирает; под нагрузкой на это время лучше вывести под из балансировки.</li>
</ul>
<p>Перед снятием дампа из продакшена помните, что в нём могут быть персональные данные, токены и пароли — с ним обращаются как с секретом.</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Под в CrashLoopBackOff. Ваши действия?»</summary>
<p>CrashLoopBackOff — симптом: контейнер раз за разом завершается, и kubelet перезапускает его с растущей задержкой. Сначала <code>kubectl describe pod</code>: в Last State — код выхода и причина, в Events — проваленные пробы. Затем <code>kubectl logs --previous</code>, потому что текущий запуск ещё ничего не написал. Код 1 или 134 — исключение приложения, обычно конфигурация, недоступная зависимость при старте или ошибка DI. 137 с OOMKilled — память; 137 без него — убит liveness-пробой или не уложился в grace period. 0 — процесс завершился сам, а Deployment всегда перезапускает. Мгновенное падение без логов — неверная команда, shell form без shell, образ под другую архитектуру.</p>
</details>
<details><summary>«Под висит в Pending. Что проверите?»</summary>
<p>Pending означает, что планировщик не нашёл узел или под ещё не начал запускаться. В <code>describe pod</code> в Events будет <code>FailedScheduling</code> с причиной: не хватает CPU или памяти — по requests, а не по фактическому потреблению; узлы с taint без соответствующих tolerations; nodeSelector или affinity не совпадают ни с одним узлом; жёсткий anti-affinity или topology spread; PersistentVolumeClaim не привязан к тому. Решения — уменьшить requests, добавить узлы (или проверить, почему cluster autoscaler их не добавил), поправить правила размещения, создать StorageClass или том. Если же событие о назначении есть, а под в ContainerCreating — проблема на узле: тома, секреты, CNI, скачивание образа.</p>
</details>
<details><summary>«Как настроить сбор метрик .NET-сервиса Prometheus-ом в кластере?»</summary>
<p>Сервис публикует метрики: встроенные метрики ASP.NET Core и рантайма через <code>System.Diagnostics.Metrics</code> и экспортёр OpenTelemetry или prometheus-net на эндпоинте <code>/metrics</code>. Для Prometheus Operator создаю ServiceMonitor, который выбирает Service по меткам и указывает имя порта и путь. Проверяю, что у ServiceMonitor есть метка, которую ждёт селектор Prometheus, и что Prometheus смотрит в этот namespace; что порт в Service назван; что эндпоинт не закрыт аутентификацией. В интерфейсе Prometheus на странице targets видно, найдена ли цель и ошибки скрейпа. Отдельно слежу за кардинальностью: метки по шаблону маршрута, а не по полному пути, никаких идентификаторов пользователей.</p>
</details>
<details><summary>«Зачем OpenTelemetry Collector, если можно слать данные прямо в бэкенд?»</summary>
<p>Коллектор отвязывает приложения от бэкендов: сервисы шлют OTLP в одно место, а куда данные уходят дальше — Tempo, Jaeger, Prometheus, Loki — решает конфигурация коллектора, без изменения и передеплоя сервисов. Он берёт на себя батчинг и повторы, уменьшая нагрузку на приложение; обогащает данные атрибутами Kubernetes; фильтрует и удаляет чувствительные поля; делает сэмплирование, включая tail-based, которое в самом приложении невозможно, потому что требует видеть трейс целиком. Обычно ставят агента на каждом узле (DaemonSet) и шлюз (Deployment) для централизованной обработки.</p>
</details>
<details><summary>«Как снять дамп памяти .NET-процесса в поде с chiseled-образом?»</summary>
<p>В образе нет ни shell, ни инструментов, поэтому exec не поможет. Варианты: заранее предусмотренный sidecar dotnet-monitor, к которому приложение подключено через <code>DOTNET_DiagnosticPorts</code>, — дамп снимается HTTP-запросом и складывается в хранилище; sidecar с инструментами и общим томом <code>emptyDir</code> в <code>/tmp</code>, где лежит диагностический сокет; ephemeral container с образом SDK через <code>kubectl debug --target</code>, где процессы видны, но к сокету и файлам приложения нужно добираться через <code>/proc/&lt;pid&gt;/root</code>. Для падений — <code>DOTNET_DbgEnableMiniDump</code> с путём на томе, но это не сработает при OOMKilled. Дамп замораживает процесс и содержит чувствительные данные, поэтому под лучше вывести из трафика, а файл хранить как секрет.</p>
</details>
<details><summary>«Что такое ephemeral container и чем он лучше kubectl exec?»</summary>
<p>Это временный контейнер, который добавляется в работающий под через <code>kubectl debug</code>, со своим образом — например, с curl, tcpdump или SDK. С <code>--target</code> он попадает в pid-namespace нужного контейнера и видит его процессы, а сеть у контейнеров пода и так общая. Exec работает только внутри образа приложения, а в минимальных образах там нет даже shell; ephemeral container позволяет держать продакшен-образ без инструментов и всё равно иметь их при отладке. Ограничения: его нельзя удалить из пода до пересоздания пода, у него нет проб и ресурсов, а права на <code>pods/ephemeralcontainers</code> в продакшене обычно выдаются ограниченно.</p>
</details>
<details><summary>«Где смотреть логи пода, который уже удалён?»</summary>
<p>Через kubectl — нигде: логи хранятся в файлах на узле, пока существует под, плюс предыдущий запуск контейнера. Поэтому в продакшене обязателен централизованный сбор: агент на каждом узле (Fluent Bit, Vector, OpenTelemetry Collector) читает файлы логов, добавляет метаданные Kubernetes и отправляет в Loki, Elasticsearch или ClickHouse. Там ищут по namespace, имени Deployment, TraceId. Если сбора нет, остаются события Kubernetes (хранятся около часа) и метрики; это аргумент настроить сбор до первого инцидента, а не после.</p>
</details>
`
    },
    {
      id: 'deploy',
      title: 'Деплой',
      html: `
<h3>От манифестов к пакетам: Helm и Kustomize</h3>
<p>Один сервис в Kubernetes — это Deployment, Service, ConfigMap, Secret или ExternalSecret, HPA, PDB, ServiceMonitor, HTTPRoute, иногда Job для миграций. Умножьте на три окружения, в которых различаются реплики, ресурсы, адреса и домены, — и копирование YAML превращается в источник ошибок. Два основных инструмента:</p>
<ul>
<li><strong>Kustomize</strong> — без шаблонов: базовые манифесты (<code>base/</code>) и наложения (<code>overlays/staging</code>, <code>overlays/production</code>), которые патчат базу — меняют число реплик, образ, добавляют переменные. Встроен в kubectl (<code>kubectl apply -k</code>). Прост и прозрачен: итоговый YAML — это исходный плюс явные патчи.</li>
<li><strong>Helm</strong> — менеджер пакетов: <strong>chart</strong> из шаблонов на Go templates и файла значений, устанавливаемый как именованный <strong>release</strong> с историей версий и откатом. Поддерживает зависимости (chart PostgreSQL или Redis как подчарт), публикацию чартов в репозитории и OCI-registry, хуки жизненного цикла. Стандарт де-факто для распространения сторонних компонентов: ingress-контроллеры, Prometheus, cert-manager, Keycloak ставятся Helm-чартами.</li>
</ul>
<p>Часто их комбинируют: сторонние компоненты — Helm-чартами, свои сервисы — общим «библиотечным» чартом компании, где описано, как выглядит типовой сервис (пробы, ресурсы, метрики, PDB), а сервис задаёт только свои значения.</p>

<h3>Helm: chart, values, release</h3>
<p>Структура чарта:</p>
<pre><code>polestar-api/
  Chart.yaml          # имя, версия чарта, appVersion
  values.yaml         # значения по умолчанию
  templates/
    deployment.yaml
    service.yaml
    configmap.yaml
    hpa.yaml
    _helpers.tpl      # общие шаблоны: имена, метки</code></pre>
<p>Фрагмент шаблона:</p>
<pre><code>apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "api.fullname" . }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  template:
    metadata:
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
    spec:
      containers:
        - name: api
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          resources:
            {{- toYaml .Values.resources | nindent 12 }}</code></pre>
<p>Здесь видны два классических приёма. <code>replicas</code> не выводится, если включён HPA, — иначе каждый <code>helm upgrade</code> сбрасывал бы число реплик, выставленное автоскейлером. Аннотация <code>checksum/config</code> меняет шаблон пода при любом изменении ConfigMap, и Deployment перекатывает поды с новой конфигурацией.</p>
<p>Команды:</p>
<pre><code>helm upgrade --install polestar-api ./charts/polestar-api \\
  -n polestar -f values.production.yaml \\
  --set image.tag=1.4.2 \\
  --atomic --wait --timeout 10m

helm history polestar-api -n polestar
helm rollback polestar-api 41 -n polestar
helm template ./charts/polestar-api -f values.production.yaml
helm diff upgrade ...    # плагин helm-diff</code></pre>
<p><code>upgrade --install</code> — идемпотентная установка-или-обновление. <code>--wait</code> ждёт готовности ресурсов, <code>--atomic</code> при неудаче (в том числе по таймауту) откатывает release к предыдущей версии — это и есть «автоматический откат», которого нет у самого Deployment (в Helm 4 флаг переименован в <code>--rollback-on-failure</code>, старое имя пока принимается с предупреждением). <code>helm template</code> рендерит манифесты локально, без кластера, — удобно для проверки в CI и для GitOps. Информация о release (какие манифесты применены в какой ревизии) хранится в кластере, в Secret-ах namespace release-а; серверного компонента, как Tiller во второй версии Helm, нет.</p>
<p><strong>Хуки</strong> позволяют выполнить ресурс в определённый момент жизненного цикла release: аннотация <code>helm.sh/hook: pre-install,pre-upgrade</code> на Job с миграциями запускает её до обновления остальных ресурсов, <code>helm.sh/hook-weight</code> задаёт порядок, <code>helm.sh/hook-delete-policy</code> — когда удалять Job. Если хук-Job завершилась ошибкой, upgrade считается неудачным, и с <code>--atomic</code> выполняется откат.</p>

<h3>GitOps: Argo CD и Flux</h3>
<p>В классическом CI/CD конвейер сам выполняет <code>kubectl apply</code> или <code>helm upgrade</code> — это модель <strong>push</strong>, и у CI должны быть права администратора в каждом кластере. <strong>GitOps</strong> переворачивает это:</p>
<ul>
<li>Желаемое состояние кластера целиком описано в Git-репозитории (манифесты, Helm-чарты со значениями, Kustomize-наложения).</li>
<li>В кластере работает контроллер — <strong>Argo CD</strong> или <strong>Flux</strong>, — который <strong>сам забирает</strong> (pull) состояние из Git и применяет его, непрерывно сравнивая с фактическим.</li>
<li>Деплой — это коммит или merge request в репозиторий окружения: CI собирает образ, кладёт его в registry и меняет тег в репозитории (сам или через инструменты вроде Argo CD Image Updater или автоматизацию Flux), а контроллер выкатывает.</li>
</ul>
<p>Что это даёт: история изменений и аудит — это история Git; откат — это <code>git revert</code>; ревью изменений инфраструктуры — обычные MR; обнаружение дрейфа — если кто-то поменял что-то руками через kubectl, контроллер покажет расхождение (OutOfSync) и, при включённом self-heal, вернёт как было; CI не нужны права в кластере. Цена — ещё одна система, которую нужно эксплуатировать, и дисциплина: «руками в продакшене ничего не меняем».</p>
<p>Нюансы, о которых спрашивают: секреты нельзя класть в Git открытым текстом — используют External Secrets Operator, Sealed Secrets или SOPS; поля, которыми управляют контроллеры в кластере (<code>replicas</code> под HPA), нужно исключить из сравнения, иначе GitOps и HPA будут спорить; порядок применения задаётся волнами синхронизации (<code>argocd.argoproj.io/sync-wave</code>) и хуками (<code>PreSync</code> для миграций, <code>PostSync</code> для смоук-тестов). Argo CD рендерит Helm-чарты сам и сопоставляет Helm-хуки со своими хуками, так что Job миграций с <code>pre-upgrade</code> работает и там, но поведение стоит проверить на своей версии.</p>

<h3>Стратегии выкатки: rolling, blue-green, canary</h3>
<p><strong>Rolling update</strong> — стратегия Deployment по умолчанию: поды заменяются порциями. Просто и дёшево, не требует двойной ёмкости. Минусы: какое-то время обслуживают обе версии вперемешку, нет управления долей трафика на новую версию, откат — такой же постепенный rolling update назад.</p>
<p><strong>Blue-green</strong>: рядом с работающей версией (blue) разворачивается полная копия новой (green), её проверяют (смоук-тесты, ручная проверка по внутреннему адресу), а затем переключают весь трафик разом — например, сменой селектора Service или маршрута шлюза. Откат — мгновенное переключение обратно, пока старая версия ещё работает. Минусы: удвоенная ёмкость на время выкатки; переключение «всё сразу» — если новая версия ломается под реальной нагрузкой, это затронет всех; общая база данных и топики всё равно должны быть совместимы с обеими версиями.</p>
<p><strong>Canary</strong>: новая версия получает небольшую долю трафика (1%, 5%, 25%…), и по метрикам (доля ошибок, латентность, бизнес-метрики) принимается решение продвигать дальше или откатывать. Риск ограничен долей пользователей, на которую пришлась проблема. Реализации:</p>
<ul>
<li>грубо — две Deployment под одним Service, и доля трафика пропорциональна числу подов (1 из 10 — 10%); без точного управления;</li>
<li>веса в маршрутизации — <code>backendRefs</code> с <code>weight</code> в HTTPRoute Gateway API, VirtualService в Istio, аннотации ingress-контроллера;</li>
<li>прогрессивная доставка — <strong>Argo Rollouts</strong> или <strong>Flagger</strong>: ресурс, заменяющий Deployment, с шагами (10% → пауза 5 минут → анализ метрик Prometheus → 50% → …) и автоматическим откатом, если анализ провален.</li>
</ul>
<p>Связанные понятия: <strong>feature flags</strong> отделяют выкатку кода от включения функциональности — код уезжает выключенным и включается для части пользователей без деплоя; <strong>shadow</strong> или зеркалирование — копия трафика уходит на новую версию, ответы которой отбрасываются, — способ проверить производительность без риска (но осторожно с запросами, у которых есть побочные эффекты).</p>
<p>Общая оговорка для всех стратегий: какое-то время работают две версии, поэтому схема базы, контракты API и форматы сообщений должны быть совместимы с обеими. Стратегия выкатки не отменяет обратной совместимости — она лишь управляет риском.</p>

<h3>Миграции базы и две версии одновременно</h3>
<p>Самая трудная часть деплоя бэкенда — не поды, а схема базы. Во время rolling update старые и новые поды работают с одной базой. Значит:</p>
<ul>
<li>Миграция, применённая до выкатки, должна быть совместима со <strong>старым</strong> кодом, который ещё работает.</li>
<li>Новый код должен работать, пока часть подов ещё старые и пишут данные по-старому.</li>
<li>Откат приложения не должен требовать отката схемы: <code>Down</code>-миграции в продакшене почти никто не выполняет — данные, записанные после миграции, при откате схемы теряются.</li>
</ul>
<p>Отсюда паттерн <strong>expand/contract</strong> (parallel change). Пример: переименовать колонку <code>client_name</code> в <code>counterparty_name</code>.</p>
<ol>
<li><strong>Expand</strong>: добавить новую колонку (nullable или с умолчанием), код пишет в обе, читает из старой. Выкатить.</li>
<li><strong>Migrate</strong>: перенести данные из старой колонки в новую (порциями, если таблица большая). Переключить код на чтение из новой. Выкатить.</li>
<li><strong>Contract</strong>: убрать из кода использование старой колонки, выкатить, и только следующим релизом удалить её из схемы.</li>
</ol>
<p>Наивное «переименуем колонку одной миграцией» ломает старые поды в момент применения миграции: они делают <code>SELECT client_name</code> и получают ошибку несуществующей колонки до тех пор, пока не будут заменены. Похожие ловушки: добавление NOT NULL колонки без умолчания (старый код не заполняет её при вставке и получает ошибку), удаление колонки, которую читает старый код, смена типа.</p>
<p>Отдельно — <strong>длинные и блокирующие миграции</strong>. Создание индекса на большой таблице блокирует запись (в PostgreSQL используют <code>CREATE INDEX CONCURRENTLY</code>, и его нельзя выполнить внутри транзакции); добавление колонки с вычисляемым значением по умолчанию может переписывать таблицу; <code>ALTER TABLE</code> ждёт эксклюзивную блокировку и, пока ждёт, блокирует все последующие запросы к таблице — поэтому ставят <code>lock_timeout</code>. Перенос данных в миллионах строк выносят из миграции в фоновую задачу.</p>

<h3>Где запускать миграции в Kubernetes</h3>
<table>
<thead><tr><th>Вариант</th><th>Плюсы</th><th>Минусы</th></tr></thead>
<tbody>
<tr><td><code>Database.Migrate()</code> при старте приложения</td><td>Ничего не надо настраивать</td><td>Каждая реплика пытается мигрировать, гонки; у приложения должны быть права менять схему; долгая миграция держит под неготовым, и его убивает проба; ошибка миграции — CrashLoopBackOff всех подов</td></tr>
<tr><td>Init container в поде приложения</td><td>Миграция гарантированно до старта приложения в этом поде; не нужен отдельный оркестратор</td><td>Выполняется в <strong>каждом</strong> поде при <strong>каждом</strong> старте — и при масштабировании HPA, и при перезапуске; конкурентный запуск N копий; права на схему в поде приложения; длинная миграция задерживает все поды</td></tr>
<tr><td>Kubernetes Job (Helm-хук <code>pre-upgrade</code>, Argo CD <code>PreSync</code>)</td><td>Ровно один запуск на релиз; свои права и свой образ; провал останавливает релиз до обновления приложения</td><td>Нужна настройка хуков; Job должна завершаться (sidecar-ы!); на первой установке хук выполняется раньше ресурсов чарта, и ConfigMap или Secret, которые он ждёт, могут ещё не существовать</td></tr>
<tr><td>Отдельный шаг конвейера</td><td>Полный контроль, явный шаг с логами, можно требовать подтверждения для опасных миграций</td><td>Конвейеру нужен сетевой доступ к базе и учётные данные; в GitOps-модели ломает принцип «всё из Git через контроллер»</td></tr>
</tbody>
</table>
<p>В зрелых командах обычно выбирают Job на релиз (хук Helm или Argo CD) или шаг конвейера, а <code>Migrate()</code> при старте оставляют для разработки. Независимо от варианта:</p>
<ul>
<li>миграции применяются <strong>до</strong> того, как новая версия получит трафик, и совместимы со старой версией (expand/contract);</li>
<li>учётная запись миграций — владелец схемы, а у приложения — роль только на DML. Так приложение физически не может испортить схему, а при включённой row-level security это ещё и разделение «кто создаёт политики» и «к кому они применяются»;</li>
<li>от параллельного запуска защищает блокировка: начиная с EF Core 9 <code>Migrate</code> берёт блокировку базы на время применения, а в других инструментах (Flyway, Liquibase) она есть давно;</li>
<li>у Job разумные <code>backoffLimit</code> и <code>activeDeadlineSeconds</code>: миграция, упавшая на середине без транзакции, не должна бесконечно перезапускаться.</li>
</ul>

<h3>Рецепт для .NET и EF Core</h3>
<p>Практичная схема, которую легко рассказать на собеседовании и которая переносится из Compose в Kubernetes почти без изменений:</p>
<ol>
<li>Один Dockerfile с общей стадией сборки и двумя итоговыми: <code>api</code> и <code>migrator</code>. Мигратор — EF Core migration bundle (<code>dotnet ef migrations bundle --self-contained</code>), исполняемый файл на образе <code>runtime-deps</code>. Оба образа получают один тег сборки, поэтому мигратор всегда соответствует коду.</li>
<li>В Compose мигратор — одноразовый сервис, а API зависит от него через <code>condition: service_completed_successfully</code>. В Kubernetes — Job с хуком <code>pre-upgrade</code> (или <code>PreSync</code> в Argo CD), которая запускается с учётными данными владельца схемы.</li>
<li>Миграции пишутся по правилам expand/contract; опасные операции (индексы на больших таблицах, перенос данных) — отдельными миграциями или фоновыми задачами.</li>
<li>Перед мержем — проверка, что модель и миграции согласованы (<code>dotnet ef migrations has-pending-model-changes</code> в CI), и генерация SQL-скрипта (<code>dotnet ef migrations script --idempotent</code>) для ревью.</li>
<li>Приложение стартует, проходит startup и readiness, rolling update заменяет старые поды; при провале — <code>helm --atomic</code> откатывает приложение, а схема остаётся, потому что совместима с предыдущей версией.</li>
</ol>
<p>Хорошее завершение ответа: «миграция — это изменение, которое нельзя откатить вместе с подами, поэтому я проектирую его так, чтобы откатывать не пришлось».</p>

<h3>Что спросят на собеседовании</h3>
<details><summary>«Где вы запускаете миграции базы в Kubernetes и почему?»</summary>
<p>Отдельной Job на релиз — хуком Helm <code>pre-upgrade</code> или <code>PreSync</code> в Argo CD — из отдельного образа-мигратора с тем же тегом, что и API, и с учётными данными владельца схемы. Так миграция выполняется ровно один раз, до обновления приложения, и её провал останавливает релиз. <code>Migrate()</code> при старте и init container выполняются в каждой реплике при каждом старте, в том числе при масштабировании, конкурируют друг с другом и требуют прав на схему у приложения; долгая миграция держит поды неготовыми, и их убивают пробы. Дополнительно миграции пишутся по expand/contract, чтобы старая версия работала с новой схемой во время rolling update и откат приложения не требовал отката схемы.</p>
</details>
<details><summary>«Как переименовать колонку без простоя?»</summary>
<p>Через expand/contract в несколько релизов. Сначала добавить новую колонку и писать в обе, читая из старой. Затем перенести данные, при большой таблице порциями, и переключить чтение на новую. Затем убрать старую колонку из кода, и только следующим релизом — из схемы. Переименование одной миграцией ломает старые поды, которые во время rolling update ещё выполняют запросы со старым именем, и делает откат приложения невозможным без отката схемы. Тот же подход — для смены типа, разбиения таблицы и добавления обязательных колонок.</p>
</details>
<details><summary>«Чем blue-green отличается от canary?»</summary>
<p>Blue-green разворачивает полную копию новой версии рядом со старой, проверяет её и переключает весь трафик разом, а откат — мгновенное переключение обратно; нужна двойная ёмкость, и проблема под реальной нагрузкой затронет всех сразу. Canary направляет на новую версию небольшую долю трафика и постепенно увеличивает её по результатам анализа метрик, ограничивая ущерб частью пользователей. Canary требует управления весами — Gateway API, сервис-меш, Argo Rollouts или Flagger — и хороших метрик для автоматического решения. В обоих случаях две версии работают одновременно, поэтому нужна совместимость схемы и контрактов.</p>
</details>
<details><summary>«Что такое GitOps и что он даёт по сравнению с helm upgrade из CI?»</summary>
<p>Желаемое состояние кластера хранится в Git, а контроллер в кластере (Argo CD или Flux) сам забирает его и применяет, непрерывно сравнивая с фактическим. Деплой — это коммит в репозиторий окружения, откат — revert, аудит — история Git, ревью — обычный merge request. Контроллер видит дрейф, если кто-то поменял ресурсы руками, и может его исправить. CI не нужны права администратора в кластере: он лишь публикует образ и меняет тег. Цена — отдельная система и дисциплина; секреты в таком репозитории хранят через ESO, Sealed Secrets или SOPS, а поля, которыми управляет HPA, исключают из сравнения.</p>
</details>
<details><summary>«Зачем в Helm-чарте аннотация checksum/config?»</summary>
<p>Изменение ConfigMap не меняет шаблон пода, поэтому Deployment не пересоздаёт поды, и переменные окружения остаются старыми. Аннотация с хэшем отрендеренного ConfigMap в шаблоне пода меняется при каждом изменении конфигурации — шаблон меняется, и Deployment выкатывает новые поды обычным rolling update с проверкой готовности. Это делает изменение конфигурации таким же управляемым, как изменение кода: плохая конфигурация остановит выкатку на первом поде, а не сломает все сразу, и её можно откатить через <code>helm rollback</code>.</p>
</details>
<details><summary>«Deployment завис на выкатке, новые поды не становятся готовыми. Откатится ли он сам?»</summary>
<p>Нет. Rolling update просто не продвигается: старые поды продолжают обслуживать трафик (если maxUnavailable это позволяет), а после <code>progressDeadlineSeconds</code> (по умолчанию 600 секунд) Deployment получает условие <code>Progressing=False</code> с причиной <code>ProgressDeadlineExceeded</code>. Откатывает внешний инструмент или человек: <code>helm upgrade --atomic</code>, Argo Rollouts при проваленном анализе, конвейер по результату <code>kubectl rollout status</code>, или <code>kubectl rollout undo</code> вручную. Причину ищут в событиях и логах новых подов — пробы, конфигурация, нехватка ресурсов для новых подов.</p>
</details>
<details><summary>«Helm или Kustomize?»</summary>
<p>Kustomize — патчи поверх базовых манифестов без шаблонного языка, встроен в kubectl, итоговый YAML легко читать и ревьюить; хорош для своих сервисов с небольшими различиями между окружениями. Helm — пакетный менеджер с шаблонами, значениями, версионированными release-ами, откатом, зависимостями и хуками; стандарт для распространения сторонних компонентов и для общего чарта типового сервиса компании. Шаблоны Helm сложнее читать и легко превратить в программирование в YAML. Их часто комбинируют: сторонние компоненты — Helm, свои — общий чарт или Kustomize, а в GitOps Argo CD умеет оба.</p>
</details>
`
    }
  ],
  questions: [
    {
      id: 'k8s-001', chapter: 'inside', type: 'choice',
      q: `Контейнеру задан лимит памяти 512 МБ, а на хосте 64 ГБ свободны. Какой механизм ядра не даст процессу занять больше 512 МБ?`,
      options: [
        `mnt namespace: контейнер видит только свою файловую систему и свою память`,
        `pid namespace: процессы контейнера не видят чужую память`,
        `cgroups: контроллер memory с лимитом memory.max, при превышении срабатывает OOM killer`,
        `overlayfs: записываемый слой ограничен размером образа`
      ],
      answer: 2,
      explain: `Namespaces отвечают за видимость, cgroups — за потребление ресурсов. Лимит памяти — это memory.max (в cgroup v2) группы контейнера; при превышении ядро сначала вытесняет page cache, а если не помогает, убивает процесс (OOMKilled, код 137). При этом /proc/meminfo внутри контейнера по-прежнему показывает память всего хоста — поэтому рантайм должен читать лимит из cgroup, что .NET и делает.`
    },
    {
      id: 'k8s-002', chapter: 'inside', type: 'choice',
      q: `В Dockerfile написано <code>ENTRYPOINT dotnet Api.dll</code>. Контейнер останавливается ровно 10 секунд и выходит с кодом 137. Наиболее вероятная причина?`,
      options: [
        `Shell form: PID 1 — это /bin/sh, который не передаёт SIGTERM процессу dotnet, и Docker добивает контейнер SIGKILL-ом после таймаута`,
        `.NET не умеет обрабатывать SIGTERM, нужен свой обработчик через PosixSignalRegistration`,
        `Docker по умолчанию сначала отправляет SIGKILL, а SIGTERM — только с флагом --graceful`,
        `Код 137 означает, что приложению не хватило памяти при остановке`
      ],
      answer: 0,
      explain: `Строковая форма ENTRYPOINT превращается в <code>/bin/sh -c "dotnet Api.dll"</code>, и сигнал получает shell, а не приложение. Generic Host .NET сам обрабатывает SIGTERM, но только если dotnet — это PID 1. Через 10 секунд (таймаут docker stop) приходит SIGKILL: 128 + 9 = 137. Исправление — exec form <code>ENTRYPOINT ["dotnet", "Api.dll"]</code>. В chiseled-образах shell form вообще не запустится — там нет shell.`
    },
    {
      id: 'k8s-003', chapter: 'inside', type: 'open',
      q: `Из чего состоит образ контейнера? Почему <code>RUN rm secret.txt</code> следующей инструкцией не убирает секрет из образа?`,
      answer: `<p>Образ — это <strong>манифест</strong>, <strong>конфигурация</strong> (Entrypoint, Cmd, ENV, пользователь, рабочий каталог, история) и упорядоченный набор <strong>слоёв</strong>. Слой — tar-архив изменений файловой системы относительно предыдущего. Все объекты адресуются по SHA-256 содержимого (digest), поэтому общие слои хранятся и скачиваются один раз; тег — изменяемый указатель, digest — неизменяемый.</p>
<p>Каждая инструкция <code>RUN</code>, <code>COPY</code>, <code>ADD</code> создаёт новый слой. Если файл добавлен в одном слое, а удалён в следующем, нижний слой остаётся в образе как есть, а в верхнем появляется лишь whiteout-маркер, скрывающий файл в объединённой файловой системе. Любой, кто скачал образ, может распаковать нижний слой и прочитать файл. Поэтому секреты в сборку передают BuildKit secret mount (<code>RUN --mount=type=secret</code>), который не попадает ни в один слой, а временные файлы создают и удаляют в одном <code>RUN</code>.</p>`
    },
    {
      id: 'k8s-004', chapter: 'inside', type: 'choice',
      q: `Контейнер завершился с кодом 143. Что это значит?`,
      options: [
        `Ошибка Docker: команда в ENTRYPOINT не найдена`,
        `Процесс убит OOM killer-ом`,
        `Segmentation fault в нативной библиотеке`,
        `Процесс получил SIGTERM и завершился по нему, не перехватив его сам (128 + 15)`
      ],
      answer: 3,
      explain: `Коды 128 + N означают завершение сигналом N. 143 = 128 + 15, SIGTERM — обычная остановка, процесс не установил обработчик (если бы установил и завершился сам, код был бы его собственный, обычно 0). OOM killer и принудительная остановка — 137 (SIGKILL), segfault — 139, «команда не найдена» — 127.`
    },
    {
      id: 'k8s-005', chapter: 'inside', type: 'open',
      q: `Объясните, чем контейнер отличается от виртуальной машины, и назовите, когда изоляции контейнера недостаточно.`,
      answer: `<p>ВМ виртуализирует железо: гипервизор запускает несколько полноценных ОС, у каждой своё ядро. Контейнер — обычный процесс на ядре хоста, которому namespaces ограничивают видимость (процессы, сеть, монтирования, hostname, IPC, пользователи), а cgroups — ресурсы (CPU, память, pids, I/O). Файловая система собирается из слоёв образа через overlayfs.</p>
<p>Следствия: старт за миллисекунды, близкие к нулю накладные расходы, образы в десятки и сотни мегабайт. Но ядро общее, и уязвимость ядра или runtime, привилегированный контейнер, смонтированный docker.sock или каталог хоста дают выход на хост.</p>
<p>Изоляции недостаточно для недоверенного кода — мультитенантные платформы, выполнение пользовательского кода, CI сторонних проектов. Там используют песочницы с отдельным ядром: gVisor, Kata Containers, Firecracker. Для своих сервисов достаточно контейнеров с запретом привилегий: non-root, read-only корень, без лишних capabilities, seccomp-профиль.</p>`
    },
    {
      id: 'k8s-006', chapter: 'inside', type: 'choice',
      q: `Коллега говорит: «В Kubernetes 1.24 убрали Docker, значит, образы, собранные docker build, больше нельзя деплоить». Что верно?`,
      options: [
        `Он прав: нужно пересобирать образы через Buildah`,
        `Удалили dockershim из kubelet; узлы работают на containerd или CRI-O, а образы Docker — стандартные OCI-образы и запускаются как раньше`,
        `Удалили поддержку формата образов Docker, остался только формат OCI 2.0`,
        `Docker удалили только из managed-кластеров, в self-hosted он остался`
      ],
      answer: 1,
      explain: `Убрали прослойку, через которую kubelet использовал Docker Engine как container runtime. Для запуска образов это ничего не меняет: Docker собирает OCI-совместимые образы. Меняется эксплуатация узлов: нет docker.sock на узле (сборки внутри кластера — через Kaniko, BuildKit, Buildah), а для отладки на узле используют crictl.`
    },
    {
      id: 'k8s-007', chapter: 'dockerfile', type: 'open',
      q: `Что не так с этим Dockerfile? Назовите все проблемы и как исправить.
<pre><code>FROM mcr.microsoft.com/dotnet/sdk:9.0
ARG NUGET_TOKEN
WORKDIR /app
COPY . .
RUN dotnet restore -p:NuGetToken=$NUGET_TOKEN
RUN dotnet publish -c Release -o out
EXPOSE 80
ENTRYPOINT dotnet out/Api.dll</code></pre>`,
      answer: `<ul>
<li><strong>SDK в итоговом образе</strong>: нет multi-stage, в продакшен уходит компилятор, исходники, кэш NuGet — сотни лишних мегабайт и уязвимостей. Нужна стадия <code>build</code> на <code>sdk</code> и итоговая на <code>aspnet</code> с <code>COPY --from=build</code>.</li>
<li><strong><code>COPY . .</code> до restore</strong>: любая правка кода инвалидирует кэш restore. Сначала копировать <code>*.csproj</code>, <code>Directory.Packages.props</code>, <code>NuGet.config</code>, выполнить restore, потом копировать исходники; в publish — <code>--no-restore</code>.</li>
<li><strong>Токен через ARG</strong>: значение, использованное в RUN, видно в <code>docker history</code>. Нужен BuildKit secret mount.</li>
<li><strong>Нет .dockerignore</strong> (по контексту): <code>COPY . .</code> затащит <code>bin</code>, <code>obj</code> с хоста, <code>.git</code>, возможно <code>.env</code>.</li>
<li><strong>Shell form ENTRYPOINT</strong>: PID 1 — shell, SIGTERM не дойдёт до приложения. Нужно <code>ENTRYPOINT ["dotnet", "Api.dll"]</code>.</li>
<li><strong>Root</strong>: нет <code>USER $APP_UID</code>.</li>
<li><strong>Порт 80</strong>: с .NET 8 образы слушают 8080 (<code>ASPNETCORE_HTTP_PORTS</code>); EXPOSE 80 вводит в заблуждение, а непривилегированный процесс 80 не откроет.</li>
</ul>`
    },
    {
      id: 'k8s-008', chapter: 'dockerfile', type: 'choice',
      q: `Токен приватного NuGet-фида передан как <code>ARG NUGET_TOKEN</code> и использован в <code>RUN dotnet restore</code> в стадии сборки multi-stage Dockerfile. Итоговая стадия на aspnet. Где токен может утечь?`,
      options: [
        `Нигде: ARG существует только во время сборки и не сохраняется`,
        `Только в итоговом образе, в его ENV`,
        `В метаданных и кэше слоёв стадии сборки — например, в кэше CI или registry кэша, — а также в логах сборки; в итоговый образ он не попадёт, если не скопирован туда`,
        `В переменных окружения каждого контейнера, запущенного из итогового образа`
      ],
      answer: 2,
      explain: `ARG не попадает в ENV итогового образа, а стадия сборки в итоговый образ не входит. Но значение, использованное в RUN, сохраняется в истории слоёв той стадии, а эти слои живут в кэше сборки, могут экспортироваться в registry кэша (--cache-to) и выводиться в логах. Правильный способ — <code>RUN --mount=type=secret</code>: файл доступен только на время инструкции и не попадает ни в слой, ни в историю.`
    },
    {
      id: 'k8s-009', chapter: 'dockerfile', type: 'choice',
      q: `Почему в Dockerfile пишут <code>USER $APP_UID</code> (числовой UID), а не <code>USER app</code>?`,
      options: [
        `Docker не поддерживает имена пользователей в инструкции USER`,
        `Kubernetes с runAsNonRoot: true проверяет, что пользователь не root, и по имени сделать это не может — под с нечисловым пользователем будет отклонён`,
        `Пользователь app есть только в chiseled-образах`,
        `Числовой UID быстрее разрешается ядром при старте`
      ],
      answer: 1,
      explain: `Kubelet при runAsNonRoot не заглядывает в /etc/passwd образа и не может узнать, что «app» — не root. Под получит CreateContainerConfigError. Числовой UID проверяем. Начиная с .NET 8 образы содержат пользователя app и переменную APP_UID с его UID; chiseled-образы уже запускаются под ним.`
    },
    {
      id: 'k8s-010', chapter: 'dockerfile', type: 'open',
      q: `Вы предлагаете перейти на chiseled-образы. Какие плюсы, минусы и подводные камни назовёте команде?`,
      answer: `<p><strong>Плюсы</strong>: заметно меньше размер, значит быстрее pull и меньше места; минимум пакетов — меньше CVE в отчётах сканера и меньше поверхность атаки; нет shell и пакетного менеджера — злоумышленнику нечем пользоваться; запуск под непривилегированным пользователем по умолчанию.</p>
<p><strong>Минусы и подводные камни</strong>:</p>
<ul>
<li>нельзя <code>kubectl exec -- sh</code>, отладка — через ephemeral containers или диагностический sidecar;</li>
<li>shell form ENTRYPOINT и скрипты-обёртки не работают;</li>
<li>HEALTHCHECK через curl и preStop через <code>exec sleep</code> не работают — нужен встроенный sleep-хук или задержка в приложении;</li>
<li>без суффикса <code>-extra</code> нет ICU и tzdata: включён инвариантный режим глобализации, <code>ru-RU</code> и <code>FindSystemTimeZoneById</code> упадут в рантайме;</li>
<li>нельзя доустановить системный пакет — если нужен, например, нативный инструмент, придётся собирать собственный базовый образ;</li>
<li>приложение не должно писать туда, куда у пользователя app нет прав.</li>
</ul>
<p>Переход стоит делать с прогоном интеграционных тестов в том же образе.</p>`
    },
    {
      id: 'k8s-011', chapter: 'dockerfile', type: 'choice',
      q: `После обновления сервиса с .NET 7 на .NET 8 поды не проходят readiness probe и Service не отвечает, хотя в логах «Now listening on: http://[::]:8080». Манифесты не меняли. В чём дело?`,
      options: [
        `.NET 8 по умолчанию требует HTTPS, нужно настроить сертификат`,
        `В .NET 8 изменился путь health-эндпоинтов`,
        `Kestrel в .NET 8 слушает только IPv6`,
        `Образы .NET 8 слушают 8080 вместо 80, а пробы и targetPort Service по-прежнему указывают на 80`
      ],
      answer: 3,
      explain: `С .NET 8 образы работают под непривилегированным пользователем и ASPNETCORE_HTTP_PORTS по умолчанию равен 8080. Манифесты с портом 80 стучатся в закрытый порт. Исправить containerPort, пробы и targetPort (лучше ссылаться на порт по имени), либо явно задать порт приложению. «[::]» означает все интерфейсы, включая IPv4.`
    },
    {
      id: 'k8s-012', chapter: 'dockerfile', type: 'choice',
      q: `Что нельзя сделать при сборке образа через <code>dotnet publish /t:PublishContainer</code>?`,
      options: [
        `Выполнить произвольную команду сборки, например установить системный пакет через apt`,
        `Выбрать chiseled-вариант базового образа`,
        `Отправить образ в удалённый registry без локального Docker`,
        `Задать несколько тегов образа`
      ],
      answer: 0,
      explain: `SDK собирает образ без Dockerfile, накладывая слой с опубликованным приложением на базовый образ, поэтому RUN-шагов нет. Базовый образ задаётся через ContainerBaseImage или ContainerFamily, теги — ContainerImageTags, а при указании ContainerRegistry образ отправляется прямо в registry без Docker-демона. Если нужен системный пакет, нужен свой базовый образ или обычный Dockerfile.`
    },
    {
      id: 'k8s-013', chapter: 'dockerfile', type: 'open',
      q: `Сборка в Docker падает с ошибками о ненайденных пакетах, хотя локально <code>dotnet build</code> проходит, а restore в Dockerfile выполнился успешно. С чего начнёте?`,
      answer: `<p>Первым делом проверю <strong>.dockerignore</strong>. Если его нет или в нём нет <code>**/bin/</code> и <code>**/obj/</code>, то <code>COPY . .</code> после restore копирует в контейнер каталоги <code>obj</code> с машины разработчика. В них лежит <code>project.assets.json</code> с путями к пакетам на хосте (часто Windows-путями) — он перезаписывает результат restore в контейнере, и publish ищет пакеты там, где их нет.</p>
<p>Дальше: совпадает ли набор файлов, скопированных до restore, с тем, от чего restore зависит (<code>Directory.Packages.props</code>, <code>NuGet.config</code>, <code>global.json</code>, все <code>.csproj</code> проектов решения — новый проект легко забыть); не отличается ли версия SDK в образе от <code>global.json</code>; совпадает ли RID при restore и publish (<code>-a</code>/<code>-r</code> в обоих, иначе <code>--no-restore</code> не найдёт ассеты под платформу).</p>`
    },
    {
      id: 'k8s-014', chapter: 'compose', type: 'choice',
      q: `В каталоге с compose.yaml лежит <code>.env</code> со строкой <code>ConnectionStrings__Default=Host=postgres;...</code>. В описании сервиса api нет ни environment, ни env_file. Что увидит приложение?`,
      options: [
        `Переменную ConnectionStrings__Default — Compose передаёт .env во все контейнеры`,
        `Ничего: .env используется для подстановки \${...} в YAML, а в окружение контейнеров сам не попадает`,
        `Переменную, но только если в образе нет ENV с тем же именем`,
        `Ошибку запуска: Compose требует объявить все переменные из .env`
      ],
      answer: 1,
      explain: `Файл .env проекта служит для интерполяции значений в самом compose-файле. Чтобы переменная попала в контейнер, нужно <code>env_file: .env</code> или явное <code>environment: { ConnectionStrings__Default: \${ConnectionStrings__Default} }</code>. Проверять — <code>docker compose config</code>.`
    },
    {
      id: 'k8s-015', chapter: 'compose', type: 'choice',
      q: `В Compose есть сервис migrator, который применяет миграции и завершается. Как сделать, чтобы api стартовал только после успешного применения миграций?`,
      options: [
        `<code>depends_on: [migrator]</code>`,
        `<code>depends_on: { migrator: { condition: service_healthy } }</code>`,
        `<code>depends_on: { migrator: { condition: service_completed_successfully } }</code>`,
        `<code>restart: on-failure</code> у api, чтобы он перезапускался, пока миграции не применятся`
      ],
      answer: 2,
      explain: `Короткая форма гарантирует только порядок запуска. service_healthy требует healthcheck и подходит долгоживущим сервисам, а не одноразовым. service_completed_successfully ждёт завершения с кодом 0 и не запускает api, если миграция упала. Перезапуски до победы скрывают ошибку и гоняют api на непромигрированной базе.`
    },
    {
      id: 'k8s-016', chapter: 'compose', type: 'open',
      q: `API в IDE подключался к базе по <code>Host=localhost;Port=5432</code>. Его перенесли в контейнер той же Compose-сети — и подключение не работает. Почему и как исправить?`,
      answer: `<p>Внутри контейнера <code>localhost</code> — это сам контейнер API, у которого свой сетевой namespace; PostgreSQL там не слушает. Порт 5432, опубликованный на хост, тоже ни при чём: он доступен на хосте, а не внутри контейнера.</p>
<p>Внутри сети Compose сервисы находят друг друга по <strong>имени сервиса</strong> через встроенный DNS Docker: <code>Host=postgres;Port=5432</code> — с внутренним портом контейнера. Строку подключения стоит передавать переменной окружения (<code>ConnectionStrings__Default</code>), чтобы для IDE и для контейнера она была разной без пересборки. Если нужно достучаться до сервиса, запущенного на хосте, используют <code>host.docker.internal</code> (на Linux — с <code>extra_hosts: host-gateway</code>).</p>`
    },
    {
      id: 'k8s-017', chapter: 'compose', type: 'choice',
      q: `На Linux-сервере в compose-файле <code>ports: ["5432:5432"]</code> у PostgreSQL, а ufw запрещает входящие на 5432. Доступна ли база из интернета?`,
      options: [
        `Да: Docker сам пишет правила iptables для опубликованных портов, и они обходят ufw; порт открыт на всех интерфейсах`,
        `Нет: ufw применяется раньше правил Docker`,
        `Нет: Compose по умолчанию публикует порты только на 127.0.0.1`,
        `Только по IPv6`
      ],
      answer: 0,
      explain: `Это известная грабля: Docker добавляет свои цепочки iptables, и опубликованный порт доступен в обход ufw. По умолчанию публикуется на 0.0.0.0. Для разработки — <code>127.0.0.1:5432:5432</code>, на сервере базу не публиковать вовсе: сервисы обращаются к ней по внутренней сети Compose.`
    },
    {
      id: 'k8s-018', chapter: 'compose', type: 'open',
      q: `У вас SaaS в Docker Compose на одном сервере. Интервьюер спрашивает: «Почему бы не остаться на этом навсегда?» Что ответите?`,
      answer: `<p>Для ранней стадии это честный выбор: просто, дёшево, понятно. Но есть пределы:</p>
<ul>
<li><strong>Один хост</strong> — единая точка отказа: умер сервер, лежит всё; никто не перенесёт сервисы на другую машину.</li>
<li><strong>Обновления с простоем</strong>: <code>up -d</code> останавливает старый контейнер и запускает новый; нет rolling update с проверкой готовности и автоматического отката.</li>
<li><strong>Нет постоянного согласования</strong>: restart policy перезапустит упавший процесс, но не заменит зависший (unhealthy) контейнер и не исправит дрейф.</li>
<li><strong>Нет масштабирования</strong> по нагрузке и распределения по узлам и зонам.</li>
<li>Слабые средства управления <strong>секретами и доступом</strong>.</li>
</ul>
<p>Переходить стоит, когда требования к доступности или нагрузка это оправдывают. Готовиться можно заранее: stateless API, конфигурация из переменных, миграции отдельным образом, пробы здоровья, graceful shutdown, логи в stdout, — тогда переезд в Kubernetes сводится к манифестам. Управляемые базу и S3 можно вынести из Compose ещё раньше.</p>`
    },
    {
      id: 'k8s-019', chapter: 'dotnet', type: 'choice',
      q: `Поду задан memory limit 1 GiB, настройки GC не трогали. Каков жёсткий лимит управляемой кучи по умолчанию?`,
      options: [
        `1 GiB — весь лимит контейнера`,
        `Лимита нет: GC учитывает только физическую память узла`,
        `512 MiB — половина лимита`,
        `75% лимита, около 768 MiB (но не меньше 20 МБ)`
      ],
      answer: 3,
      explain: `При заданном лимите памяти cgroup GCHeapHardLimit по умолчанию — max(20 МБ, 75% лимита). Оставшаяся четверть — запас под память вне управляемой кучи: JIT, стеки потоков, нативные библиотеки. Изменить можно через System.GC.HeapHardLimit / HeapHardLimitPercent.`
    },
    {
      id: 'k8s-020', chapter: 'dotnet', type: 'choice',
      q: `Под на 16-ядерном узле, <code>requests.cpu: 500m</code>, <code>limits.cpu: 1500m</code>. Чему равен <code>Environment.ProcessorCount</code> в .NET 8?`,
      options: [
        `16 — рантайм видит все ядра узла`,
        `1 — по requests, округлённым вверх`,
        `2 — по CPU-квоте (limit), округлённой вверх`,
        `1.5 — дробное значение квоты`
      ],
      answer: 2,
      explain: `Рантайм учитывает CPU-квоту cgroup, в которую превращается limit, и округляет вверх: 1.5 → 2. Request (веса cgroup) на ProcessorCount не влияет. Без limit было бы 16 — тогда стоит задать DOTNET_PROCESSOR_COUNT. ProcessorCount — целое число.`
    },
    {
      id: 'k8s-021', chapter: 'dotnet', type: 'open',
      q: `Объясните разницу между OutOfMemoryException и OOMKilled для .NET-сервиса в Kubernetes и как диагностировать каждый случай.`,
      answer: `<p><strong>OutOfMemoryException</strong> бросает GC внутри процесса, когда аллокацию нельзя выполнить в пределах heap hard limit даже после полной сборки. Это исключение со стеком: оно попадает в логи, процесс обычно падает с необработанным исключением, можно настроить дамп при падении (<code>DOTNET_DbgEnableMiniDump</code>). Причины — утечка управляемых объектов, неограниченный кэш, загрузка огромного файла целиком.</p>
<p><strong>OOMKilled</strong> — ядро убило контейнер, превысивший memory limit cgroup: SIGKILL, код 137, в <code>kubectl describe</code> Last State Reason OOMKilled. Приложение ничего не успевает записать, дамп при падении не снимается. Причины — память вне управляемой кучи (нативные библиотеки, потоки, memory-mapped файлы), слишком высокий HeapHardLimitPercent, лимит меньше реальной потребности.</p>
<p>Диагностика OOMKilled — по метрикам до падения: сравнить <code>container_memory_working_set_bytes</code> с размером GC-кучи. Растёт куча — снять gcdump или дамп заранее (dotnet-monitor с триггером по памяти). Растёт разница — искать нативную память. Иначе — поднять лимит под реальное потребление.</p>`
    },
    {
      id: 'k8s-022', chapter: 'dotnet', type: 'choice',
      q: `Что такое DATAS в .NET GC?`,
      options: [
        `Режим, в котором GC отключает фоновые сборки ради меньших пауз`,
        `Режим Server GC, динамически подстраивающий число куч под нагрузку, начиная с одной; в .NET 9 включён по умолчанию`,
        `Механизм выгрузки неиспользуемых сборок в контейнерах`,
        `Режим Workstation GC для контейнеров с одним CPU`
      ],
      answer: 1,
      explain: `Dynamic Adaptation To Application Sizes: Server GC больше не держит фиксированную кучу на каждый процессор, а добавляет и убирает кучи по мере роста и спада аллокаций. Это решает проблему раздутой памяти Server GC на больших узлах. В .NET 8 включался явно, в .NET 9 — по умолчанию для Server GC; выключается через GarbageCollectionAdaptationMode=0.`
    },
    {
      id: 'k8s-023', chapter: 'dotnet', type: 'open',
      q: `У пода <code>terminationGracePeriodSeconds: 30</code>, preStop со sleep 10, а в приложении <code>HostOptions.ShutdownTimeout</code> оставлен по умолчанию. Какие проблемы видите и как настроить?`,
      answer: `<p><code>ShutdownTimeout</code> по умолчанию с .NET 6 — 30 секунд. Grace period отсчитывается с начала удаления пода и включает preStop: 10 секунд уходит на sleep, и на остановку хоста остаётся 20. Если дренирование запросов или остановка фоновых сервисов займут больше 20 секунд, kubelet пришлёт SIGKILL раньше, чем хост сдастся сам: оборванные запросы, незакоммиченные offset-ы, потерянные логи.</p>
<p>Настройка: бюджет <code>preStop + ShutdownTimeout + запас &lt; terminationGracePeriodSeconds</code>. Например, grace 45 секунд, preStop 10, ShutdownTimeout 25. Для сервисов с долгими операциями grace увеличивают. Дополнительно — <code>BackgroundService</code> должны уважать <code>stoppingToken</code>, консьюмеры коммитить offset и закрываться, а при нескольких hosted services в .NET 8 можно включить <code>ServicesStopConcurrently</code>, чтобы они не делили таймаут последовательно.</p>`
    },
    {
      id: 'k8s-024', chapter: 'dotnet', type: 'choice',
      q: `Сервис запущен в Alpine-образе .NET 8 с настройками по умолчанию и выполняет <code>new CultureInfo("ru-RU")</code>. Что произойдёт?`,
      options: [
        `CultureNotFoundException: в образе включён инвариантный режим глобализации, а в нём создание культур, кроме инвариантной, по умолчанию запрещено`,
        `Культура создастся, но форматирование будет как у en-US`,
        `Приложение не запустится с ошибкой «ICU not found»`,
        `Всё сработает: Alpine-образы содержат ICU`
      ],
      answer: 0,
      explain: `Alpine-образы .NET идут с DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=true и без ICU. С .NET 6 в инвариантном режиме создание неинвариантной культуры бросает CultureNotFoundException. Ошибка «ICU not found» при старте — это случай, когда ICU нет, а инвариантный режим не включён. Для русского форматирования нужен образ с ICU (вариант <code>-alpine-extra</code>, или установить icu-libs и выключить инвариантный режим, или chiseled-extra).`
    },
    {
      id: 'k8s-025', chapter: 'dotnet', type: 'choice',
      q: `В манифесте задана переменная <code>DOTNET_GCHeapHardLimitPercent=50</code>. Какой процент от лимита памяти получит куча?`,
      options: [
        `50%`,
        `Настройка будет проигнорирована: этот параметр задаётся только в runtimeconfig.json`,
        `80%: значения GC-переменных окружения читаются как шестнадцатеричные, 0x50 = 80`,
        `5%: значение делится на 10`
      ],
      answer: 2,
      explain: `Значения настроек GC в переменных окружения интерпретируются как шестнадцатеричные. «50» — это 0x50, то есть 80. Чтобы получить 50%, нужно 0x32. В runtimeconfig.json (System.GC.HeapHardLimitPercent) значения десятичные, поэтому настройки GC надёжнее задавать в проекте.`
    },
    {
      id: 'k8s-026', chapter: 'k8s-basics', type: 'choice',
      q: `Сервису заказов нужно обращаться к сервису каталога внутри кластера. Снаружи каталог недоступен. Какой тип Service выбрать?`,
      options: [
        `NodePort`,
        `LoadBalancer`,
        `ExternalName`,
        `ClusterIP`
      ],
      answer: 3,
      explain: `ClusterIP даёт стабильное DNS-имя и виртуальный IP, доступные только внутри кластера, — стандарт для межсервисного общения и тип по умолчанию. NodePort и LoadBalancer открывают сервис наружу; ExternalName — DNS-псевдоним на внешнее имя без проксирования.`
    },
    {
      id: 'k8s-027', chapter: 'k8s-basics', type: 'open',
      q: `Когда нужен StatefulSet, а когда достаточно Deployment? Чем они отличаются?`,
      answer: `<p><strong>Deployment</strong> — для stateless-сервисов, где реплики взаимозаменяемы: веб-API, воркеры, консьюмеры. Поды получают случайные имена, создаются и удаляются в любом порядке, общий том им не нужен (состояние — в базе, кэше, S3). Rolling update через ReplicaSet-ы, откат.</p>
<p><strong>StatefulSet</strong> — когда у реплики есть идентичность и собственное состояние: базы, Kafka, ZooKeeper, Elasticsearch, etcd. Он даёт стабильные имена (<code>pg-0</code>, <code>pg-1</code>) и DNS-записи через headless Service, отдельный PersistentVolumeClaim у каждой реплики через <code>volumeClaimTemplates</code>, который переживает пересоздание пода, упорядоченный запуск, остановку и обновление (по умолчанию по одной реплике, в обратном порядке).</p>
<p>Для бэкенд-разработчика практический вывод: свои сервисы — Deployment; базы в кластере — StatefulSet, а чаще оператор (CloudNativePG, Strimzi) или управляемый сервис облака, потому что сам StatefulSet не умеет ни failover, ни бэкапы.</p>`
    },
    {
      id: 'k8s-028', chapter: 'k8s-basics', type: 'open',
      q: `gRPC-сервис масштабировали с 3 до 10 реплик, но нагрузка осталась на трёх старых подах. Почему?`,
      answer: `<p><strong>kube-proxy балансирует TCP-соединения, а не запросы</strong>, а gRPC держит одно долгое HTTP/2-соединение и мультиплексирует в нём все вызовы, поэтому клиенты остаются привязаны к старым подам.</p>
<p>Решение о балансировке kube-proxy принимается при установке соединения. Клиент gRPC мультиплексирует вызовы в существующих соединениях и не открывает новых. Решения: headless Service и клиентская балансировка (DNS-резолвер и round_robin в .NET gRPC), L7-балансировка через сервис-меш или прокси, ограничение времени жизни соединения. Для gRPC, к слову, есть и нативная grpc-проба.</p>`
    },
    {
      id: 'k8s-029', chapter: 'k8s-basics', type: 'open',
      q: `Что не так с этими манифестами? Сервис не отвечает.
<pre><code>apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalog
spec:
  replicas: 2
  selector:
    matchLabels:
      app: catalog
  template:
    metadata:
      labels:
        app: catalog
    spec:
      containers:
        - name: api
          image: registry.local/catalog:latest
---
apiVersion: v1
kind: Service
metadata:
  name: catalog
spec:
  selector:
    app: catalog-api
  ports:
    - port: 80
      targetPort: 80</code></pre>`,
      answer: `<ul>
<li><strong>Селектор Service не совпадает с метками подов</strong>: <code>app: catalog-api</code> против <code>app: catalog</code>. EndpointSlice пустой, запросам некуда идти — главная причина «не отвечает».</li>
<li><strong>targetPort 80</strong>: .NET 8+ образ слушает 8080. Даже с правильным селектором соединение не установится. Лучше объявить <code>containerPort: 8080</code> с именем <code>http</code> и ссылаться по имени.</li>
<li><strong>Тег latest</strong>: невоспроизводимый деплой, неизвестно, какая версия работает; изменение образа под тем же тегом не вызовет rolling update; откат невозможен.</li>
<li><strong>Нет resources</strong>: под BestEffort, вытесняется первым; планировщик не знает его потребностей; HPA по CPU работать не сможет.</li>
<li><strong>Нет проб</strong>: трафик пойдёт на неготовые поды, зависшие не перезапустятся, rolling update не будет ждать готовности.</li>
</ul>
<p>Проверка первой проблемы: <code>kubectl get endpointslices -l kubernetes.io/service-name=catalog</code> и <code>kubectl get pods --show-labels</code>.</p>`
    },
    {
      id: 'k8s-030', chapter: 'k8s-basics', type: 'open',
      q: `Вы изменили ConfigMap, значения из которого переданы в поды через envFrom, и выполнили kubectl apply. Что произойдёт с работающими подами?`,
      answer: `<p><strong>Ничего</strong>: новые поды не появятся, а работающие процессы сохранят старые значения — переменные окружения фиксируются при старте контейнера.</p>
<p>Deployment реагирует только на изменение template, а ссылка на ConfigMap в шаблоне та же. Переменные окружения процесса нельзя поменять снаружи. Чтобы применить, нужны rollout restart или хэш конфигурации в аннотации шаблона (checksum/config в Helm), либо монтирование ConfigMap томом и перечитывание файла приложением.</p>`
    },
    {
      id: 'k8s-031', chapter: 'pod-lifecycle', type: 'choice',
      q: `Readiness probe пода провалилась три раза подряд. Что сделает Kubernetes?`,
      options: [
        `Уберёт под из эндпоинтов Service; контейнер продолжит работать и вернётся в балансировку, когда проба снова пройдёт`,
        `Перезапустит контейнер`,
        `Удалит под и создаст новый на другом узле`,
        `Ничего, пока не провалится liveness probe`
      ],
      answer: 0,
      explain: `Readiness управляет только участием в трафике: condition Ready = False, под исчезает из EndpointSlice. Перезапуск — дело liveness (и startup). Пересоздание на другом узле Kubernetes из-за проб не делает никогда.`
    },
    {
      id: 'k8s-032', chapter: 'pod-lifecycle', type: 'choice',
      q: `В liveness probe всех сервисов включена проверка PostgreSQL. База ушла в failover на 40 секунд. Что вероятнее всего произойдёт?`,
      options: [
        `Ничего: liveness проверяет только процесс, и проверка базы в ней игнорируется`,
        `Поды станут неготовыми и вернутся в балансировку после failover`,
        `Kubernetes подождёт, пока база вернётся, а потом перезапустит поды по одному`,
        `Все реплики одновременно будут перезапущены; после возвращения базы её накроет шторм подключений стартующих подов, возможны повторные падения и растущие задержки CrashLoopBackOff`
      ],
      answer: 3,
      explain: `Liveness с внешней зависимостью превращает сбой зависимости в рестарт всего, что от неё зависит. Перезапуск не чинит базу, но убивает сервисы, которые могли бы отдавать понятные ошибки или кэш, и создаёт лавину подключений. Liveness должна проверять только сам процесс; зависимости — в readiness (осторожно) или в диагностике для мониторинга.`
    },
    {
      id: 'k8s-033', chapter: 'pod-lifecycle', type: 'open',
      q: `Опишите последовательность завершения пода и объясните, зачем нужен preStop hook со sleep, если приложение и так корректно обрабатывает SIGTERM.`,
      answer: `<ol>
<li>Под помечается удаляемым (Terminating).</li>
<li>Параллельно: контроллер EndpointSlice убирает под из эндпоинтов, и kube-proxy на всех узлах, ingress-контроллеры и меш постепенно обновляют маршрутизацию; одновременно kubelet выполняет preStop, затем шлёт SIGTERM главному процессу.</li>
<li>Kubelet ждёт до <code>terminationGracePeriodSeconds</code> (по умолчанию 30, включая preStop), потом SIGKILL.</li>
</ol>
<p>Корректная обработка SIGTERM в ASP.NET Core означает, что Kestrel <strong>сразу перестаёт принимать новые соединения</strong> и дорабатывает текущие. Но маршрутизация обновляется не мгновенно: ещё секунду-две (и дольше на больших кластерах) новые запросы продолжают приходить на под — и получают отказ соединения, клиент видит 502. preStop со sleep 5–10 секунд держит приложение полностью работающим, пока все балансировщики не узнали об удалении, и только потом SIGTERM запускает дренирование. В chiseled-образах вместо <code>exec sleep</code> нужен встроенный <code>preStop.sleep</code> или задержка внутри приложения (<code>IHostedLifecycleService.StoppingAsync</code>). Grace period должен вместить sleep и дренирование.</p>`
    },
    {
      id: 'k8s-034', chapter: 'pod-lifecycle', type: 'open',
      q: `Под на chiseled-образе .NET, в манифесте <code>preStop: { exec: { command: ["sleep", "10"] } }</code>. Что произойдёт при удалении пода?`,
      answer: `<p><strong>Хук упадёт</strong>: в образе нет бинарника <code>sleep</code>. Kubelet запишет событие <code>FailedPreStopHook</code> и сразу отправит SIGTERM, так что задуманной задержки не будет.</p>
<p>exec-хук запускается внутри контейнера, а в chiseled нет ни shell, ни sleep. Провал preStop не блокирует удаление: kubelet пишет событие и переходит к SIGTERM, так что гонка эндпоинтов возвращается. Решение — встроенное действие <code>lifecycle.preStop.sleep.seconds</code> (включено по умолчанию с 1.30, стабильно с 1.34) или задержка в приложении.</p>`
    },
    {
      id: 'k8s-035', chapter: 'pod-lifecycle', type: 'choice',
      q: `У Deployment 3 реплики и стратегия RollingUpdate с параметрами по умолчанию. Как пройдёт обновление?`,
      options: [
        `Сразу удалятся все три пода, затем создадутся три новых`,
        `Создадутся три новых пода, затем удалятся три старых`,
        `maxSurge = 1, maxUnavailable = 0: создаётся один новый под, после его готовности удаляется один старый, и так далее; подов никогда не меньше трёх`,
        `maxSurge = 0, maxUnavailable = 1: удаляется один старый, затем создаётся один новый`
      ],
      answer: 2,
      explain: `По умолчанию оба параметра — 25%; maxSurge округляется вверх (0.75 → 1), maxUnavailable вниз (0.75 → 0). Ёмкость сохраняется, но нужен ресурс на четвёртый под. Первый вариант — стратегия Recreate.`
    },
    {
      id: 'k8s-036', chapter: 'pod-lifecycle', type: 'open',
      q: `Что такое PodDisruptionBudget, от чего он защищает и от чего — нет? Какие ошибки в его настройке встречаются?`,
      answer: `<p>PDB ограничивает число одновременно недоступных подов приложения при <strong>добровольных нарушениях</strong> — тех, что идут через Eviction API: <code>kubectl drain</code> при обслуживании и обновлении узлов, уменьшение кластера автоскейлером. Задаётся <code>minAvailable</code> или <code>maxUnavailable</code> и селектором; если вытеснение нарушит бюджет, API откажет, и drain подождёт.</p>
<p><strong>Не защищает</strong> от падения узла, OOMKilled, kernel panic, отказа зоны; от прямого <code>kubectl delete pod</code> и удаления Deployment; от rolling update Deployment — у него свой <code>maxUnavailable</code>.</p>
<p><strong>Ошибки</strong>: <code>minAvailable</code>, равный числу реплик, или <code>minAvailable: 1</code> на приложении с одной репликой — вытеснение невозможно никогда, обслуживание узлов блокируется; PDB с селектором, не совпадающим с подами; PDB без распределения реплик по узлам — при падении узла с тремя репликами он ничего не спасёт. Разумно — <code>maxUnavailable: 1</code> и topology spread по узлам и зонам.</p>`
    },
    {
      id: 'k8s-037', chapter: 'pod-lifecycle', type: 'choice',
      q: `Что будет, если в стратегии Deployment задать <code>maxSurge: 0</code> и <code>maxUnavailable: 0</code>?`,
      options: [
        `Обновление будет идти по одному поду`,
        `Обновление будет мгновенным, без промежуточных состояний`,
        `Kubernetes заменит значения на 25% по умолчанию`,
        `API отклонит манифест: при обоих нулях обновление не может сдвинуться — нельзя ни добавить под, ни убрать`
      ],
      answer: 3,
      explain: `Валидация Deployment запрещает одновременно нулевые maxSurge и maxUnavailable. Если нужно обновление без дополнительной ёмкости — maxSurge: 0, maxUnavailable: 1; без потери ёмкости — maxSurge: 1, maxUnavailable: 0.`
    },
    {
      id: 'k8s-038', chapter: 'resources', type: 'choice',
      q: `У единственного контейнера пода: requests cpu 500m, memory 1Gi; limits cpu 500m, memory 1Gi. Какой QoS-класс у пода?`,
      options: [
        `Guaranteed`,
        `Burstable`,
        `BestEffort`,
        `Critical`
      ],
      answer: 0,
      explain: `Guaranteed — когда у каждого контейнера заданы CPU и memory, и requests равны limits. Такой под вытесняется последним при нехватке ресурсов узла. Burstable — заданы, но не всё равно; BestEffort — ничего не задано. Класса Critical нет; приоритет задаётся отдельно через PriorityClass.`
    },
    {
      id: 'k8s-039', chapter: 'resources', type: 'choice',
      q: `p99 латентности сервиса растёт под всплесками, при этом средняя загрузка CPU — 35% от лимита. Какая метрика лучше всего подтвердит гипотезу о CPU throttling?`,
      options: [
        `<code>container_memory_working_set_bytes</code>`,
        `<code>kube_pod_container_status_restarts_total</code>`,
        `Отношение <code>rate(container_cpu_cfs_throttled_periods_total)</code> к <code>rate(container_cpu_cfs_periods_total)</code>`,
        `<code>node_load1</code> узла`
      ],
      answer: 2,
      explain: `Доля CFS-периодов, в которых контейнер упёрся в квоту, показывает троттлинг, скрытый усреднением: многопоточный всплеск выбирает квоту за доли 100-мс периода, и остаток периода процесс стоит. Средняя загрузка за минуту при этом низкая. Память и рестарты здесь ни при чём, а нагрузка узла не говорит о квоте конкретного контейнера.`
    },
    {
      id: 'k8s-040', chapter: 'resources', type: 'open',
      q: `Ставить ли CPU limits для .NET API? Дайте взвешенный ответ.`,
      answer: `<p><strong>Против</strong>: CPU limit — это CFS-квота, и многопоточный процесс в всплеске троттлится, получая хвосты латентности при низкой средней загрузке. Свободный CPU узла простаивает. Защиту от соседей даёт CPU request: он становится весом, и при конкуренции каждый получает свою долю. CPU сжимаем, переедание не убивает соседей.</p>
<p><strong>За</strong>: предсказуемость поведения и нагрузочных тестов; защита от бесконечного цикла; мультиарендные кластеры и учёт затрат; Guaranteed QoS; политики кластера.</p>
<p><strong>Специфика .NET</strong>: без limit <code>Environment.ProcessorCount</code> равен числу ядер узла — большой минимум пула потоков и, без DATAS (до .NET 9), десятки куч Server GC. Поэтому без limit стоит задать <code>DOTNET_PROCESSOR_COUNT</code> около request.</p>
<p><strong>Мой вариант</strong>: точные requests по метрикам; memory limit = memory request; для latency-критичных API CPU limit не ставлю или ставлю с большим запасом и слежу за долей троттлинга; решение подтверждаю нагрузочным тестом.</p>`
    },
    {
      id: 'k8s-041', chapter: 'resources', type: 'choice',
      q: `HPA с целью 60% CPU. Сейчас 4 реплики со средней утилизацией 90% (от requests). Сколько реплик запросит HPA?`,
      options: [
        `5`,
        `6`,
        `8`,
        `4 — изменение в пределах допуска`
      ],
      answer: 1,
      explain: `desired = ceil(4 × 90 / 60) = ceil(6) = 6. Отклонение 50% далеко за пределами допуска (около 10%). Масштабирование вверх по умолчанию без окна стабилизации, вниз — с окном 5 минут.`
    },
    {
      id: 'k8s-042', chapter: 'resources', type: 'choice',
      q: `Консьюмер Kafka масштабируется KEDA по лагу, <code>maxReplicaCount: 20</code>, в топике 6 партиций, настройки скейлера по умолчанию. Сколько реплик будет при огромном лаге?`,
      options: [
        `20 — максимум из ScaledObject`,
        `Лаг не влияет: KEDA масштабирует Kafka-консьюмеры только по CPU`,
        `12 — по две реплики на партицию`,
        `6: больше реплик, чем партиций, бесполезно — лишние консьюмеры группы простаивают, и скейлер по умолчанию столько не поднимает`
      ],
      answer: 3,
      explain: `В консьюмер-группе партиция читается одним консьюмером, поэтому седьмая и последующие реплики не получат партиций. Kafka-скейлер KEDA по умолчанию ограничивает число реплик числом партиций (параметр allowIdleConsumers это меняет). Чтобы масштабироваться дальше, увеличивают число партиций — с учётом того, что это меняет распределение ключей.`
    },
    {
      id: 'k8s-043', chapter: 'resources', type: 'open',
      q: `Почему HPA по памяти для .NET-сервиса — плохая идея и что использовать вместо неё?`,
      answer: `<p>HPA пропорционально увеличивает реплики, когда средняя память выше цели, и уменьшает, когда ниже. Но память .NET-процесса после спада нагрузки не обязана уменьшаться: GC держит выделенные сегменты, чтобы не просить их у ОС снова, рабочий набор остаётся высоким. Рост нагрузки поднимет число реплик, а вниз HPA почти никогда не вернётся. Кроме того, новая реплика не уменьшает память старых — память не делится между подами так, как CPU-нагрузка.</p>
<p>Что использовать: CPU (утилизация от requests) — для вычислительно нагруженных API; RPS или число активных запросов на под через Prometheus Adapter; латентность с осторожностью; для консьюмеров — лаг через KEDA. Память же контролируют лимитом и алертами, а не автоскейлингом.</p>`
    },
    {
      id: 'k8s-044', chapter: 'resources', type: 'choice',
      q: `В контейнере указаны только <code>limits: { cpu: "1", memory: 1Gi }</code>, requests не указаны. Что получит планировщик?`,
      options: [
        `requests будут равны limits: cpu 1, memory 1Gi`,
        `requests будут нулевыми, под BestEffort`,
        `Манифест отклонят: requests обязательны`,
        `requests возьмутся из среднего потребления за прошлую неделю`
      ],
      answer: 0,
      explain: `Если limit задан, а request нет, request по умолчанию приравнивается к limit (если LimitRange namespace не задаёт иное). Такой под будет Guaranteed. Автоматический подбор по истории — это VPA, а не поведение по умолчанию.`
    },
    {
      id: 'k8s-045', chapter: 'config', type: 'choice',
      q: `Какое утверждение о Kubernetes Secret верно?`,
      options: [
        `Значения зашифрованы ключом кластера и недоступны даже администраторам`,
        `Значения шифруются в etcd всегда, а base64 — дополнительная защита`,
        `Значения закодированы base64, а не зашифрованы; в etcd они по умолчанию лежат открыто, и любой, кто может создать под в namespace, может прочитать любой секрет этого namespace`,
        `Secret безопасно хранить в Git, потому что base64 нельзя декодировать без ключа`
      ],
      answer: 2,
      explain: `Base64 — кодирование. Шифрование в etcd включается отдельно (EncryptionConfiguration, лучше с KMS). Право создавать поды позволяет смонтировать любой секрет namespace. Плюсы Secret перед ConfigMap — отдельные права RBAC, tmpfs, передача только на нужные узлы. В Git — только через Sealed Secrets, SOPS или ссылки External Secrets Operator.`
    },
    {
      id: 'k8s-046', chapter: 'config', type: 'open',
      q: `Файл <code>appsettings.Kubernetes.json</code> из ConfigMap смонтирован в под через <code>subPath</code>. ConfigMap обновили. Когда файл в поде изменится?`,
      answer: `<p><strong>Никогда, пока под не пересоздадут.</strong></p>
<p>Обычные тома ConfigMap обновляются с задержкой через атомарную подмену символической ссылки, но subPath-монтирование фиксирует файл при старте. Если нужна горячая перезагрузка — монтировать каталог целиком без subPath; надёжнее — пересоздавать поды при изменении конфигурации.</p>`
    },
    {
      id: 'k8s-047', chapter: 'config', type: 'open',
      q: `Команда хочет менять уровень логирования и таймауты сервиса без пересборки. Как организуете конфигурацию в Kubernetes и как изменения будут доходить до работающих подов?`,
      answer: `<p>Значения — в ConfigMap (секреты отдельно, в Secret или внешнем хранилище), один образ на все окружения. Передача — переменными окружения с двойным подчёркиванием (<code>Logging__LogLevel__Default</code>) или JSON-файлом томом, который подключён в <code>IConfiguration</code>.</p>
<p>Доставка изменений — двумя путями:</p>
<ul>
<li><strong>Рекомендуемый</strong>: пересоздание подов при изменении конфигурации. Хэш ConfigMap в аннотации шаблона пода (<code>checksum/config</code> в Helm) или оператор вроде Reloader; изменение проходит rolling update с readiness, а ошибочная конфигурация, пойманная <code>ValidateOnStart</code>, останавливает выкатку на первом поде.</li>
<li><strong>Горячая перезагрузка</strong>: том без subPath, <code>reloadOnChange: true</code>, чтение через <code>IOptionsMonitor</code>. Минусы: задержка синхронизации kubelet, ненадёжное отслеживание подмены символических ссылок (может понадобиться polling через <code>DOTNET_USE_POLLING_FILE_WATCHER</code>), объекты, построенные при старте, сами не перестроятся, и плохое значение сразу попадает во все поды.</li>
</ul>
<p>Для уровня логирования горячая перезагрузка удобна, для остального — rolling update.</p>`
    },
    {
      id: 'k8s-048', chapter: 'config', type: 'choice',
      q: `Как задать ключ конфигурации <code>Kafka:Consumer:GroupId</code> переменной окружения в манифесте так, чтобы это работало везде?`,
      options: [
        `<code>KAFKA_CONSUMER_GROUPID</code>`,
        `<code>Kafka.Consumer.GroupId</code>`,
        `<code>Kafka:Consumer:GroupId</code>`,
        `<code>Kafka__Consumer__GroupId</code>`
      ],
      answer: 3,
      explain: `Провайдер переменных окружения ASP.NET Core превращает двойное подчёркивание в разделитель секций. Двоеточие работает не во всех оболочках и средах, точки не являются разделителем, одинарное подчёркивание — просто часть имени. Имена ключей конфигурации нечувствительны к регистру, поэтому регистр в переменной значения не имеет.`
    },
    {
      id: 'k8s-049', chapter: 'config', type: 'open',
      q: `Вы переходите на GitOps (Argo CD). Как быть с секретами, которые сейчас создаются вручную через kubectl?`,
      answer: `<p>В Git нельзя класть Secret открытым текстом — base64 не защищает. Варианты:</p>
<ul>
<li><strong>External Secrets Operator</strong>: значения живут во внешнем хранилище (Vault, облачный менеджер секретов, Yandex Lockbox), в Git — только <code>ExternalSecret</code> со ссылками; оператор синхронизирует их в Kubernetes Secret. Даёт аудит, ротацию и единый источник истины.</li>
<li><strong>Sealed Secrets</strong>: в Git лежит объект, зашифрованный публичным ключом контроллера в кластере; расшифровать может только он. Просто, но ключ контроллера надо бэкапить, а ротация значений — вручную.</li>
<li><strong>SOPS</strong>: значения в YAML зашифрованы ключами KMS или age и расшифровываются при деплое (плагины Argo CD, встроенная поддержка во Flux).</li>
<li><strong>Vault Agent Injector или CSI-драйвер</strong>: секреты вообще не становятся объектами Kubernetes, приложение получает их файлом.</li>
</ul>
<p>Я бы выбрал ESO с внешним хранилищем, если оно уже есть в компании, и добавил шифрование etcd и строгий RBAC, потому что синхронизированный Secret всё равно лежит в кластере.</p>`
    },
    {
      id: 'k8s-050', chapter: 'observability', type: 'open',
      q: `Под в состоянии ImagePullBackOff. Что и в каком порядке проверите?`,
      answer: `<ol>
<li><code>kubectl describe pod</code> — в Events точное сообщение registry.</li>
<li><strong>«not found» / «manifest unknown»</strong>: опечатка в имени или теге, образ не опубликован (упал шаг push в CI), тег удалён политикой очистки registry. Проверяю, что такой тег есть в registry.</li>
<li><strong>«unauthorized» / «denied»</strong>: у пода или его ServiceAccount нет <code>imagePullSecrets</code>, секрет в другом namespace, неверный тип секрета, истёк токен (у облачных registry токены короткоживущие).</li>
<li><strong>«toomanyrequests»</strong>: лимит частоты Docker Hub — нужно зеркало или pull-through cache.</li>
<li><strong>Таймауты и сетевые ошибки</strong>: узлы не имеют доступа к registry (фаервол, прокси, DNS), недоверенный сертификат приватного registry.</li>
<li>Если сообщение неочевидно — пробую с узла <code>crictl pull</code>.</li>
</ol>
<p>Отдельно: образ скачался, но падает с <code>exec format error</code> — это уже не ImagePullBackOff, а CrashLoopBackOff из-за архитектуры (arm64 на amd64) — нужна мультиархитектурная сборка.</p>`
    },
    {
      id: 'k8s-051', chapter: 'observability', type: 'open',
      q: `Под воркера в CrashLoopBackOff, в Last State: Terminated, Reason: Completed, Exit Code: 0. Что происходит?`,
      answer: `<p>Процесс <strong>завершается сам и успешно</strong>, а у Deployment <code>restartPolicy: Always</code>, поэтому kubelet перезапускает его снова и снова с растущей задержкой.</p>
<p>CrashLoopBackOff бывает и с кодом 0: долгоживущий сервис не должен выходить. Причины — забыли app.Run() или await RunAsync, BackgroundService вышел из цикла (а хост с ним остановился), в контейнере запускается не тот процесс. Если задача действительно разовая, её место — Job, а не Deployment.</p>`
    },
    {
      id: 'k8s-052', chapter: 'observability', type: 'choice',
      q: `Контейнер упал и уже перезапущен. Как увидеть логи запуска, в котором произошло падение?`,
      options: [
        `<code>kubectl logs pod-name --previous</code>`,
        `<code>kubectl logs pod-name --all</code>`,
        `<code>kubectl describe pod pod-name</code>`,
        `Никак: при перезапуске логи удаляются`
      ],
      answer: 0,
      explain: `kubelet хранит логи текущего и предыдущего экземпляра контейнера, и --previous (-p) показывает предыдущий. describe покажет код выхода и события, но не вывод приложения. Логи старше предыдущего запуска и логи удалённых подов есть только в централизованном хранилище.`
    },
    {
      id: 'k8s-053', chapter: 'observability', type: 'open',
      q: `Под раз в несколько часов получает OOMKilled. В логах перед падением ничего подозрительного. Как будете искать причину?`,
      answer: `<p>Отсутствие логов ожидаемо: SIGKILL не даёт приложению ничего записать, и дамп при падении тоже не снимется. Поэтому диагностика по данным, собранным <strong>до</strong> падения:</p>
<ol>
<li><code>kubectl describe pod</code>: подтверждаю Reason OOMKilled и код 137, смотрю лимит.</li>
<li>Метрики: <code>container_memory_working_set_bytes</code> контейнера и размер GC-кучи (<code>dotnet_gc_heap_size</code> или аналог) на одном графике. Растёт куча — утечка управляемых объектов; растёт разница — нативная память или потоки; скачок — разовая аллокация (большой ответ, загрузка файла целиком).</li>
<li>Корреляция с нагрузкой и событиями: определённые запросы, задачи по расписанию, размер сообщений.</li>
<li>Если растёт куча — снимаю <code>dotnet-gcdump</code> или дамп при, скажем, 80% лимита: вручную или dotnet-monitor с триггером по памяти. Анализирую <code>dumpheap -stat</code> и <code>gcroot</code>: что держит объекты (статические кэши, подписки на события, незакрытые ресурсы).</li>
<li>Если растёт нативная часть — проверяю нативные зависимости, число потоков, memory-mapped файлы; при необходимости уменьшаю HeapHardLimitPercent, чтобы оставить ей места.</li>
</ol>
<p>Если утечки нет и потребление просто больше лимита под нагрузкой — поднимаю лимит по фактическим перцентилям.</p>`
    },
    {
      id: 'k8s-054', chapter: 'observability', type: 'open',
      q: `Вы создали ServiceMonitor для сервиса, но в Prometheus (kube-prometheus-stack) цели нет вообще. Какая причина наиболее вероятна?`,
      answer: `<p>Вероятнее всего, ServiceMonitor <strong>не подхвачен самим Prometheus</strong>: у него нет метки, которую ждёт <code>serviceMonitorSelector</code> (часто <code>release</code>), или Prometheus не смотрит в этот namespace.</p>
<p>Prometheus Operator подхватывает только ServiceMonitor-ы, подходящие под его селекторы объектов и namespace-ов; при установке через Helm-чарт это часто метка release. Если цель появилась, но с ошибкой, — смотреть порт (имя порта Service), путь и аутентификацию. ServiceMonitor выбирает Service, а не поды; аннотации prometheus.io/* оператор не использует.</p>`
    },
    {
      id: 'k8s-055', chapter: 'observability', type: 'open',
      q: `Под в статусе Running, READY 0/1, рестартов нет. Что происходит?`,
      answer: `<p>Процесс работает, но <strong>не проходит readiness probe</strong>, поэтому под исключён из эндпоинтов Service и трафика не получает.</p>
<p>READY показывает, сколько контейнеров прошли readiness. Рестартов нет — liveness проходит или не настроена. В describe будут события «Readiness probe failed» с кодом ответа или таймаутом: неверный путь или порт, зависимость в readiness недоступна, приложение ещё прогревается, слишком маленький timeoutSeconds.</p>`
    },
    {
      id: 'k8s-056', chapter: 'deploy', type: 'open',
      q: `Миграции EF Core сейчас применяются в init container пода API. Сервис масштабируется HPA от 3 до 30 реплик. Какие проблемы видите и что предложите?`,
      answer: `<p><strong>Проблемы</strong>:</p>
<ul>
<li>init container выполняется в каждом поде при каждом старте: при выкатке, при каждом масштабировании HPA, при перезапуске после OOM. При всплеске нагрузки 27 новых подов одновременно начинают «мигрировать» — проверять историю, конкурировать за блокировки, нагружать базу в самый неподходящий момент;</li>
<li>параллельный запуск — гонки, если инструмент не берёт блокировку (EF Core делает это с версии 9);</li>
<li>долгая миграция задерживает старт всех подов, в том числе тех, что HPA поднимает для обработки нагрузки;</li>
<li>учётные данные владельца схемы оказываются в поде приложения;</li>
<li>неудачная миграция — все новые поды в Init:CrashLoopBackOff, а при масштабировании нельзя даже добавить ёмкость.</li>
</ul>
<p><strong>Предложение</strong>: отдельный образ-мигратор (EF Core migration bundle) с тем же тегом, что API; Kubernetes Job один раз на релиз — хуком Helm <code>pre-upgrade</code> или <code>PreSync</code> Argo CD — с учётными данными владельца схемы, <code>backoffLimit</code> и <code>activeDeadlineSeconds</code>; провал Job останавливает релиз. Приложение работает с ролью только на DML. Миграции пишем по expand/contract, чтобы старая версия работала с новой схемой во время rolling update и откат приложения не требовал отката схемы.</p>`
    },
    {
      id: 'k8s-057', chapter: 'deploy', type: 'choice',
      q: `Нужно переименовать колонку <code>client_name</code> в <code>counterparty_name</code> в сервисе с rolling update. Какой порядок правильный?`,
      options: [
        `Одна миграция с RENAME COLUMN перед выкаткой нового кода`,
        `Выкатить новый код, затем выполнить RENAME COLUMN`,
        `Добавить новую колонку и писать в обе; перенести данные и переключить чтение; убрать старую колонку из кода и лишь следующим релизом удалить её из схемы`,
        `Включить стратегию Recreate на время релиза и переименовать колонку одной миграцией — других вариантов нет`
      ],
      answer: 2,
      explain: `Это expand/contract. Переименование до выкатки ломает старые поды, которые ещё читают client_name; после — ломает новые, пока миграция не применена; и в обоих случаях откат приложения требует отката схемы. Recreate устраняет одновременную работу версий ценой простоя, но откат по-прежнему проблемен — это не «единственный вариант».`
    },
    {
      id: 'k8s-058', chapter: 'deploy', type: 'choice',
      q: `Зачем в шаблоне пода Helm-чарта аннотация <code>checksum/config</code> с хэшем ConfigMap?`,
      options: [
        `Чтобы любое изменение ConfigMap меняло шаблон пода, и Deployment выкатывал новые поды с новой конфигурацией`,
        `Чтобы Kubernetes проверял целостность ConfigMap при монтировании`,
        `Чтобы Helm не применял ConfigMap, если его содержимое не изменилось`,
        `Это требование Helm 3 для всех ресурсов с конфигурацией`
      ],
      answer: 0,
      explain: `Изменение ConfigMap само по себе не меняет template Deployment, и поды продолжают работать со старыми переменными. Хэш в аннотации делает изменение конфигурации изменением шаблона — отсюда управляемый rolling update с проверкой готовности и откат через helm rollback.`
    },
    {
      id: 'k8s-059', chapter: 'deploy', type: 'open',
      q: `Расскажите про blue-green и canary: как реализуются в Kubernetes, чем отличаются и что общего остаётся проблемой?`,
      answer: `<p><strong>Blue-green</strong>: полная копия новой версии рядом со старой, проверка по внутреннему адресу, затем переключение всего трафика разом — сменой селектора Service, маршрута Gateway API или ingress. Откат — мгновенное переключение обратно. Минусы: двойная ёмкость и «всё сразу» при переключении.</p>
<p><strong>Canary</strong>: новая версия получает малую долю трафика, которая растёт по шагам при хороших метриках. Реализации: грубо — соотношение числа подов двух Deployment под одним Service; точно — веса <code>backendRefs</code> в HTTPRoute, сервис-меш; автоматически — Argo Rollouts или Flagger с анализом метрик Prometheus и автооткатом. Ущерб ограничен долей пользователей.</p>
<p><strong>Общая проблема</strong> — какое-то время работают обе версии: схема базы, контракты API и сообщений должны быть совместимы с обеими (expand/contract), а консьюмеры Kafka обеих версий читают одни топики. Для canary ещё нужны хорошие метрики и достаточно трафика, иначе решение принимается по шуму. Связанный инструмент — feature flags, отделяющие выкатку кода от включения функции.</p>`
    },
    {
      id: 'k8s-060', chapter: 'deploy', type: 'choice',
      q: `Какое утверждение лучше всего описывает GitOps?`,
      options: [
        `CI после сборки выполняет kubectl apply в каждый кластер`,
        `Желаемое состояние кластера хранится в Git, а контроллер в кластере сам забирает его, применяет и непрерывно сверяет с фактическим, показывая и исправляя дрейф`,
        `Все манифесты генерируются из кода приложения при каждом запуске`,
        `Разработчики деплоят, отправляя push в репозиторий приложения, без registry`
      ],
      answer: 1,
      explain: `GitOps — pull-модель: Argo CD или Flux в кластере синхронизируют его с репозиторием окружения. Деплой — коммит, откат — revert, аудит — история Git, а CI не нужны права в кластере. Первый вариант — классический push-деплой. Образы по-прежнему публикуются в registry, меняется лишь тег в репозитории окружения.`
    }
  ]
});
