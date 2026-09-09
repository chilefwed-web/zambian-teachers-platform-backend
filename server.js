require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// =============================================
// INITIALIZE APP
// =============================================
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
 app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// =============================================
// SUPABASE CONNECTION
// =============================================
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// =============================================
// HEALTH CHECK
// =============================================
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Zambian Teachers Platform API',
        payment_enabled: process.env.PAYMENT_ENABLED === 'true',
        manual_approval: process.env.MANUAL_APPROVAL_ENABLED === 'true',
        message: '???? Zambian Teachers Platform is running!'
    });
});

// =============================================
// GENERATE SCHEME OF WORK
// =============================================
app.post('/api/generate-scheme', async (req, res) => {
    try {
        const { subject_code, form_level, term, academic_year } = req.body;

        if (!subject_code || !form_level || !term || !academic_year) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // 1. Get the subject ID
        const { data: subject, error: subjectError } = await supabase
            .from('subjects')
            .select('id')
            .eq('code', subject_code)
            .single();

        if (subjectError || !subject) {
            return res.status(404).json({ error: 'Subject not found' });
        }

        // 2. Get the form ID
        const { data: form, error: formError } = await supabase
            .from('forms')
            .select('id')
            .eq('level', form_level)
            .single();

        if (formError || !form) {
            return res.status(404).json({ error: 'Form not found' });
        }

        // 3. Get topics for this subject and form
        const { data: topics, error: topicsError } = await supabase
            .from('topics')
            .select(`
                id,
                name,
                topic_number,
                theme_id,
                themes (name)
            `)
            .eq('form_id', form.id)
            .eq('theme_id', (await supabase
                .from('themes')
                .select('id')
                .eq('subject_id', subject.id)
                .limit(1)
            ).data?.[0]?.id)
            .order('topic_number');

        if (topicsError || !topics || topics.length === 0) {
            return res.status(404).json({ error: 'No topics found for this subject and form' });
        }

        // 4. Generate the Scheme of Work
        const scheme = {
            subject: subject_code,
            form: `Form ${form_level}`,
            term: term,
            academic_year: academic_year,
            total_weeks: 12,
            start_date: new Date().toISOString().split('T')[0],
            topics: topics.map((topic, index) => ({
                week: index + 1,
                topic: topic.name,
                topic_number: topic.topic_number,
                hours: 4,
                theme: topic.themes?.name || 'General',
                status: 'planned'
            }))
        };

        res.json({
            success: true,
            message: 'Scheme of Work generated successfully',
            data: scheme
        });

    } catch (error) {
        console.error('Error generating scheme:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// =============================================
// GENERATE LESSON PLAN
// =============================================
app.post('/api/generate-lesson', async (req, res) => {
    try {
        const { topic_number, form_level } = req.body;

        if (!topic_number || !form_level) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // 1. Get the topic with competences
        const { data: topic, error: topicError } = await supabase
            .from('topics')
            .select(`
                id,
                name,
                topic_number,
                form_id,
                sub_topics (
                    id,
                    name,
                    sub_topic_number,
                    competences (
                        id,
                        code,
                        description,
                        learning_activities (
                            description,
                            activity_type
                        ),
                        expected_standards (
                            description
                        )
                    )
                )
            `)
            .eq('topic_number', topic_number)
            .eq('form_id', (await supabase
                .from('forms')
                .select('id')
                .eq('level', form_level)
                .single()
            ).data?.id)
            .single();

        if (topicError || !topic) {
            return res.status(404).json({ error: 'Topic not found' });
        }

        // 2. Extract competences and activities
        const subTopics = topic.sub_topics || [];
        const competences = subTopics.flatMap(st => 
            st.competences?.map(c => ({
                sub_topic: st.name,
                code: c.code,
                description: c.description,
                activities: c.learning_activities || [],
                expected: c.expected_standards?.[0]?.description || ''
            })) || []
        );

        // 3. Build the lesson plan
        const lessonPlan = {
            topic: topic.name,
            topic_number: topic.topic_number,
            form: `Form ${form_level}`,
            total_competences: competences.length,
            competences: competences,
            core_competencies: [
                'Critical Thinking',
                'Communication',
                'Collaboration',
                'Digital Literacy'
            ],
            values: ['Patriotism', 'Respect', 'Integrity'],
            activities: competences.flatMap(c => 
                c.activities.map(a => ({
                    competence: c.code,
                    activity: a.description,
                    type: a.activity_type
                }))
            )
        };

        res.json({
            success: true,
            message: 'Lesson Plan generated successfully',
            data: lessonPlan
        });

    } catch (error) {
        console.error('Error generating lesson plan:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// =============================================
// GENERATE ASSESSMENT
// =============================================
app.post('/api/generate-assessment', async (req, res) => {
    try {
        const { topic_number, form_level, assessment_type } = req.body;

        if (!topic_number || !form_level) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // 1. Get the topic with competences and expected standards
        const { data: topic, error: topicError } = await supabase
            .from('topics')
            .select(`
                id,
                name,
                topic_number,
                sub_topics (
                    id,
                    name,
                    competences (
                        id,
                        code,
                        description,
                        expected_standards (
                            description
                        )
                    )
                )
            `)
            .eq('topic_number', topic_number)
            .single();

        if (topicError || !topic) {
            return res.status(404).json({ error: 'Topic not found' });
        }

        // 2. Extract expected standards
        const subTopics = topic.sub_topics || [];
        const standards = subTopics.flatMap(st =>
            st.competences?.flatMap(c =>
                c.expected_standards?.map(e => ({
                    competence: c.code,
                    description: c.description,
                    expected: e.description
                })) || []
            ) || []
        );

        // 3. Build the assessment
        const assessment = {
            topic: topic.name,
            topic_number: topic.topic_number,
            form: `Form ${form_level}`,
            type: assessment_type || 'CA (Continuous Assessment)',
            total_questions: standards.length,
            questions: standards.map((s, i) => ({
                question_number: i + 1,
                question: `Explain how ${s.description.split(' ').slice(0, 5).join(' ')}...`,
                expected_answer: s.expected,
                marks: 4
            })),
            total_marks: standards.length * 4,
            time_minutes: standards.length * 5,
            instructions: "Answer all questions. Show your working where applicable."
        };

        res.json({
            success: true,
            message: 'Assessment generated successfully',
            data: assessment
        });

    } catch (error) {
        console.error('Error generating assessment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// =============================================
// START SERVER
// =============================================
// =============================================
// HEALTH CHECK ROUTE
// =============================================
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Zambian Teachers Platform API',
        payment_enabled: process.env.PAYMENT_ENABLED === 'true',
        manual_approval: process.env.MANUAL_APPROVAL_ENABLED === 'true',
        message: '🇿🇲 Zambian Teachers Platform is running!'
    });
});
// =============================================
// GENERATE SCHEME OF WORK ROUTE
// =============================================
app.post('/api/generate-scheme', async (req, res) => {
    try {
        const { subject_code, form_level, term, academic_year } = req.body;

        if (!subject_code || !form_level || !term || !academic_year) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // 1. Get the subject ID
        const { data: subject, error: subjectError } = await supabase
            .from('subjects')
            .select('id')
            .eq('code', subject_code)
            .single();

        if (subjectError || !subject) {
            return res.status(404).json({ error: 'Subject not found' });
        }

        // 2. Get the form ID
        const { data: form, error: formError } = await supabase
            .from('forms')
            .select('id')
            .eq('level', form_level)
            .single();

        if (formError || !form) {
            return res.status(404).json({ error: 'Form not found' });
        }

        // 3. Get topics for this subject and form
        const { data: topics, error: topicsError } = await supabase
            .from('topics')
            .select(`
                id,
                name,
                topic_number,
                theme_id,
                themes (name)
            `)
            .eq('form_id', form.id)
            .eq('theme_id', (await supabase
                .from('themes')
                .select('id')
                .eq('subject_id', subject.id)
                .limit(1)
            ).data?.[0]?.id)
            .order('topic_number');

        if (topicsError || !topics || topics.length === 0) {
            return res.status(404).json({ error: 'No topics found for this subject and form' });
        }

        // 4. Generate the Scheme of Work
        const scheme = {
            subject: subject_code,
            form: `Form ${form_level}`,
            term: term,
            academic_year: academic_year,
            total_weeks: 12,
            start_date: new Date().toISOString().split('T')[0],
            topics: topics.map((topic, index) => ({
                week: index + 1,
                topic: topic.name,
                topic_number: topic.topic_number,
                hours: 4,
                theme: topic.themes?.name || 'General',
                status: 'planned'
            }))
        };

        res.json({
            success: true,
            message: 'Scheme of Work generated successfully',
            data: scheme
        });

    } catch (error) {
        console.error('Error generating scheme:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.listen(PORT, () => {
    console.log(`? Zambian Teachers Platform Backend running on port ${PORT}`);
    console.log(`?? URL: http://localhost:${PORT}`);
    console.log(`???? API is ready!`);
});