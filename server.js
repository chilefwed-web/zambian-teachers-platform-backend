require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// =============================================
// INITIALIZE APP
// =============================================
const app = express();
const PORT = process.env.PORT || 5000;

// =============================================
// CORS CONFIGURATION (MANUAL - SOLVES CONNECTION ISSUES)
// =============================================
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// =============================================
// MIDDLEWARE
// =============================================
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
// GENERATE SCHEME OF WORK
// =============================================
app.post('/api/generate-scheme', async (req, res) => {
    try {
        console.log('Received request:', req.body);
        const { subject_code, form_level, term, academic_year } = req.body;

        if (!subject_code || !form_level || !term || !academic_year) {
            console.log('Missing fields');
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // 1. Get the subject ID
        const { data: subject, error: subjectError } = await supabase
            .from('subjects')
            .select('id')
            .eq('code', subject_code)
            .single();

        console.log('Subject query result:', { data: subject, error: subjectError });

        if (subjectError || !subject) {
            return res.status(404).json({ error: 'Subject not found' });
        }

        // 2. Get the form ID
        const { data: form, error: formError } = await supabase
            .from('forms')
            .select('id')
            .eq('level', form_level)
            .single();

        console.log('Form query result:', { data: form, error: formError });

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
            .order('topic_number');

        console.log('Topics query result:', { count: topics?.length, error: topicsError });

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
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// =============================================
// START SERVER
// =============================================
app.listen(PORT, () => {
    console.log(`✅ Zambian Teachers Platform Backend running on port ${PORT}`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`🇿🇲 API is ready!`);
});
